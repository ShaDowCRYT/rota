import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../.env"), quiet: true });

const EVENTS_PER_TEAM = 10_000;
const GROUP_SIZE = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_TIME_MS = Date.parse("2026-11-24T00:00:00.000Z");

interface ParsedArgs {
  cleanup: boolean;
  teamId?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const cleanup = args.includes("--cleanup");
  const teamIndex = args.indexOf("--team");
  if (teamIndex === -1) return { cleanup };

  const teamId = args[teamIndex + 1];
  if (teamId === undefined || !UUID_PATTERN.test(teamId)) {
    throw new Error("invalid --team value");
  }
  return { cleanup, teamId };
}

async function cleanupSeedTeams(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number }>(`
    with removed as (
      delete from activity_events
      where team_id in (select id from teams where name like 'seed-%')
      returning 1
    )
    select count(*)::int as count from removed
  `);

  await pool.query(`
    delete from memberships
    where team_id in (select id from teams where name like 'seed-%')
  `);
  await pool.query(`
    delete from user_teams
    where team_id in (select id from teams where name like 'seed-%')
  `);
  await pool.query(`delete from teams where name like 'seed-%'`);
  await pool.query(`delete from users where email like 'seed-%@example.invalid'`);

  return result.rows[0]?.count ?? 0;
}

async function clearMarkedEvents(pool: Pool, teamId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `with removed as (
       delete from activity_events
       where team_id = $1::uuid
         and payload->>'source' = 'phase23-seed'
       returning 1
     )
     select count(*)::int as count from removed`,
    [teamId],
  );
  return result.rows[0]?.count ?? 0;
}

async function insertEvents(
  pool: Pool,
  teamIds: readonly string[],
  actorIdByTeam: ReadonlyMap<string, string>,
): Promise<void> {
  for (const teamId of teamIds) {
    const actorId = actorIdByTeam.get(teamId);
    if (actorId === undefined) throw new Error("missing actor for team");

    const count = EVENTS_PER_TEAM / GROUP_SIZE;
    const ids: string[] = [];
    const teamIdsColumn: string[] = [];
    const types: string[] = [];
    const actors: string[] = [];
    const payloads: string[] = [];
    const times: string[] = [];

    for (let group = 0; group < count; group += 1) {
      const createdAt = new Date(BASE_TIME_MS + group * 1000).toISOString();
      for (let member = 0; member < GROUP_SIZE; member += 1) {
        const index = group * GROUP_SIZE + member;
        ids.push(randomUUID());
        teamIdsColumn.push(teamId);
        types.push("shift_created");
        actors.push(actorId);
        payloads.push(
          JSON.stringify({
            source: "phase23-seed",
            group,
            index,
            shiftId: randomUUID(),
          }),
        );
        times.push(createdAt);
      }
    }

    await pool.query(
      `insert into activity_events (id, team_id, type, actor_id, payload, created_at)
       select * from unnest(
         $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::jsonb[], $6::timestamptz[]
       )`,
      [ids, teamIdsColumn, types, actors, payloads, times],
    );
  }
}

async function createSeedTeam(
  pool: Pool,
  name: string,
): Promise<{ teamId: string; actorId: string }> {
  const email = `${name}@example.invalid`;
  const userResult = await pool.query<{ id: string }>(
    `insert into users (email, password_hash)
     values ($1, null)
     on conflict (email) do update set email = excluded.email
     returning id::text as id`,
    [email],
  );
  const actorId = userResult.rows[0]?.id;
  if (actorId === undefined) throw new Error("user insert returned no id");

  const teamResult = await pool.query<{ id: string }>(
    `insert into teams (name, owner_id) values ($1, $2::uuid)
     returning id::text as id`,
    [name, actorId],
  );
  const teamId = teamResult.rows[0]?.id;
  if (teamId === undefined) throw new Error("team insert returned no id");

  await pool.query(
    `insert into memberships (team_id, user_id, role)
     values ($1::uuid, $2::uuid, 'owner')`,
    [teamId, actorId],
  );
  await pool.query(
    `insert into user_teams (user_id, team_id) values ($1::uuid, $2::uuid)`,
    [actorId, teamId],
  );

  return { teamId, actorId };
}

async function findTeamActor(
  pool: Pool,
  teamId: string,
): Promise<string | undefined> {
  const result = await pool.query<{ ownerId: string }>(
    `select owner_id::text as "ownerId" from teams where id = $1::uuid`,
    [teamId],
  );
  return result.rows[0]?.ownerId;
}

async function main(): Promise<void> {
  const { cleanup, teamId } = parseArgs(process.argv.slice(2));
  const connectionString =
    process.env.DATABASE_URL_DIRECT?.trim() ?? process.env.DATABASE_URL?.trim();
  if (connectionString === undefined || connectionString === "") {
    throw new Error("database URL is required");
  }

  const pool = new Pool({ connectionString });
  try {
    const removedSeedEvents = await cleanupSeedTeams(pool);
    if (cleanup) {
      process.stdout.write(
        `${JSON.stringify({ cleanup: true, removedSeedEvents })}\n`,
      );
      return;
    }

    const actorIdByTeam = new Map<string, string>();
    const teamIds: string[] = [];

    if (teamId !== undefined) {
      const actorId = await findTeamActor(pool, teamId);
      if (actorId === undefined) throw new Error("team not found");
      const removedMarked = await clearMarkedEvents(pool, teamId);
      teamIds.push(teamId);
      actorIdByTeam.set(teamId, actorId);
      process.stdout.write(
        `${JSON.stringify({ teamId, removedMarkedEvents: removedMarked })}\n`,
      );
    }

    const seedCount = teamId === undefined ? 6 : 5;
    for (let index = 1; index <= seedCount; index += 1) {
      const { teamId: seededTeamId, actorId } = await createSeedTeam(
        pool,
        `seed-${index}`,
      );
      teamIds.push(seededTeamId);
      actorIdByTeam.set(seededTeamId, actorId);
    }

    await insertEvents(pool, teamIds, actorIdByTeam);

    const countResult = await pool.query<{ count: number }>(
      `select count(*)::int as count from activity_events where team_id = any($1::uuid[])`,
      [teamIds],
    );
    process.stdout.write(
      `${JSON.stringify({
        cleanup: false,
        removedSeedEvents,
        teams: teamIds.length,
        eventsPerTeam: EVENTS_PER_TEAM,
        totalEvents: countResult.rows[0]?.count ?? 0,
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Activity seed failed.\n");
  process.exitCode = 1;
});
