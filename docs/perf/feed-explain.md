# Activity feed EXPLAIN evidence

Date: 2026-11-24

Team used for the proof: `5ade7d09-4934-4546-83d8-52a69f6ce672`

Migration that adds the index: `server/drizzle/shard/0002_brief_slayback.sql`

## Seed evidence

- `select count(*) from activity_events where team_id = ...` returned `10000`.
- Events were seeded in groups of five with the same `created_at`. Example groups:

| created_at | rows |
|---|---:|
| 2026-11-24 00:33:19+00 | 5 |
| 2026-11-24 00:33:18+00 | 5 |
| 2026-11-24 00:33:17+00 | 5 |

Cursor used for both plans:

```json
{
  "t": "2026-11-24 00:16:39+00",
  "i": "8bddbcc6-4c02-43a7-aa54-c82ad701e079"
}
```

The first 21 returned IDs were identical before and after the index, including
`75143a3e-5f95-4b3c-ac8f-8ee812157a4a`,
`5671b8ff-3f99-4ef3-acb6-83acd2f4704e`, and
`33c52620-bf74-4284-856d-0dbeac5e6e6a`. This confirms the index did not change
keyset ordering when timestamps are equal.

## Query

```sql
select
  id::text as id,
  type,
  actor_id::text as actor_id,
  payload,
  created_at::text as created_at_text,
  created_at
from activity_events
where team_id = $1::uuid
  and (created_at, id) < ($2::timestamptz, $3::uuid)
order by activity_events.created_at desc, activity_events.id desc
limit 21;
```

The `activity_events.` prefix matters. Without it, `ORDER BY id` resolves to the
output alias `id::text`, which makes the index unable to provide the order.

## Before index

`Seq Scan` + `Sort`; 55001 rows removed by filter.

```text
Limit  (cost=2971.70..2971.76 rows=21 width=258) (actual time=7.699..7.703 rows=21.00 loops=1)
  Buffers: shared hit=1715
  ->  Sort  (cost=2971.70..2984.02 rows=4926 width=258) (actual time=7.697..7.699 rows=21.00 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 46kB
        Buffers: shared hit=1715
        ->  Seq Scan on activity_events  (cost=0.00..2838.89 rows=4926 width=258) (actual time=0.015..5.929 rows=4999.00 loops=1)
              Filter: ((team_id = '5ade7d09-4934-4546-83d8-52a69f6ce672'::uuid) AND (ROW(created_at, id) < ROW('2026-11-24 00:16:39+00'::timestamp with time zone, '8bddbcc6-4c02-43a7-aa54-c82ad701e079'::uuid)))
              Rows Removed by Filter: 55001
              Buffers: shared hit=1715
Planning:
  Buffers: shared hit=40
Planning Time: 0.191 ms
Execution Time: 7.748 ms
```

## After index

`Index Scan` using `activity_events_team_created_id_idx`; no sort node.

```text
Limit  (cost=0.41..30.18 rows=21 width=258) (actual time=0.027..0.041 rows=21.00 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using activity_events_team_created_id_idx on activity_events  (cost=0.41..6983.37 rows=4926 width=258) (actual time=0.026..0.038 rows=21.00 loops=1)
        Index Cond: ((team_id = '5ade7d09-4934-4546-83d8-52a69f6ce672'::uuid) AND (ROW(created_at, id) < ROW('2026-11-24 00:16:39+00'::timestamp with time zone, '8bddbcc6-4c02-43a7-aa54-c82ad701e079'::uuid)))
        Index Searches: 1
        Buffers: shared hit=4
Planning:
  Buffers: shared hit=40
Planning Time: 0.219 ms
Execution Time: 0.092 ms
```

## Result

- Execution time: `7.748 ms` before, `0.092 ms` after.
- Shared buffers: `1715` before, `4` after.
- The index is `(team_id, created_at DESC, id DESC)`, which matches the feed's
  team filter and keyset order.
