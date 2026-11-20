# Learning Log

## 2026-11-14: Phase 0, server foundation

Set up the project folder using npm init -y, which creates `package.json`. This file acts as an ID card and instruction sheet for the backend folder. It holds the name, the scripts, and the list of packages needed, and npm install downloaded those packages. I learned that TypeScript strict mode is a compiler setting that activates a bundle of rigorous type-checking rules to catch bugs during development. It is a strict teacher that catches mistakes early. dotenv reads the root `.env` file and copies its values into `process.env` in Node.js applications, and Zod helps with runtime data checking. I also learnt the difference between npm run dev and npm run build: npm run dev runs the TypeScript directly and restarts the server when a file changes for live coding, while npm run build compiles the code into plain JavaScript in `dist` with `tsc` and does not optimize or minify anything. Both commands execute scripts defined inside your project's `package.json` file. The part that got confusing for me was understanding what a `/health` check was, but I now understand it as a route: a rule that maps a request to a response. The `/health` route specifically checks whether the service is running and answering requests, not whether it can handle heavy traffic.

## 2026-11-14: Phase 0, testable app and lint

The Express application was moved into a separate file called `app.ts`. This file now contains and exports the app, while `index.ts` is only responsible for loading the environment and starting the server.

A test was added using Vitest to check if the `/health` route works correctly. The test starts the server on a free port, sends a request, checks the response status and message, and then closes the server.

ESLint was also added to the project to help identify common coding mistakes. It checks the code in the `src/` folder using recommended JavaScript and TypeScript rules.

The main reason for these changes is to make the application easier to test and maintain. Separating the app from the server startup allows tests to run without automatically starting the main server.

One small ESLint customization was added to ignore unused parameters that start with an underscore. This helps avoid unnecessary warnings when a parameter is intentionally not used.

## 2026-11-14: Phase 0, database pool and readiness

The environment settings were updated to require a PostgreSQL database URL and a pool-size number. A database connection pool was also created to manage database connections properly.

Drizzle was connected to the PostgreSQL pool through `db/client.ts`. The pool also has timeouts and error handling to help manage connection problems.

The health checks were improved. The `/health` route checks if the server is running, while `/health/ready` checks if the database is available by running a simple query. The pool size comes from `DB_POOL_MAX`, which defaults to 10 and allows at most 20.

If the database check fails, the server logs the actual error but returns a simple 503 error message to the user. On success, it returns `{"status":"ok","database":"ok"}`.

Finally, the server was updated to shut down properly when stopped. It stops accepting new requests, closes database connections, and exits safely. This helps prevent connections from being left open.

## 2026-11-15: Phase 0, Redis connection and readiness

The server was updated to use Redis by adding a REDIS_URL environment variable. The server now checks for this variable before starting and creates the Redis connection only when needed.

The /health/ready endpoint was improved to check both PostgreSQL and Redis. It returns a successful response only when both services are working properly.

The shutdown process was also updated. When the server is stopped, it first stops accepting requests, then closes the Redis connection and the database pool properly.

Tests were added to check different situations where Redis and PostgreSQL are either working or unavailable. Fake functions were used, so the tests do not need real database or Redis connections.

Finally, the environment secrets were kept safe, and no sensitive information was exposed. Docker Redis was started and left running, but nothing was committed to Git.

## 2026-11-15: Phase 0, continuous integration

The Express app was updated to hide the X-Powered-By header. A test was also added to make sure the header is no longer sent by the server.

A GitHub Actions workflow was created to automatically check the code whenever changes are pushed to the main branch or a pull request is made.

The workflow runs several checks, including type-checking, linting, testing, building the app, and checking production dependencies for security issues.

The CI setup uses Node.js 24 and the committed lockfile to ensure dependencies are installed correctly. It also uses read-only permissions for better security.

Finally, the workflow does not require secrets or real database and Redis services to run. A decision was also documented to explain why this setup was chosen.

## 2026-11-15: Phase 0, Sentry error tracking

The server can now send error reports to Sentry when a Sentry DSN is provided. If no DSN is configured, Sentry will not be activated.

To protect users' privacy, sensitive information such as request bodies, cookies, and login details is removed before error reports are sent. Users only receive a simple error message, while the full error details are saved in the server logs and Sentry.

Sentry's Express handler was added after the routes are defined, so errors passed through the app are captured before the final generic error handler responds.

Tests were added using a fake Sentry connection. This ensures that errors are tested without sending real reports to Sentry.

Finally, the setup was tested, and a decision was documented to explain how error reporting works while keeping sensitive information safe.

## 2026-11-16: Phase 0, mobile app foundation

The Rota mobile app was created using Expo and TypeScript. It displays the app name and checks whether the backend server is working through the /health/ready endpoint.

A light and dark theme was added to the app. Reusable components such as text, buttons, cards, and status displays were also created to make the design consistent.

An API helper was added to connect the mobile app to the backend. It has a 10-second timeout to prevent requests from taking too long.

TanStack Query was added to manage data fetching. The app can now show loading, error, and success states. It also allows users to retry failed requests and refresh the screen.

Finally, the app's environment settings and documentation were added. The TypeScript code was also checked to ensure there were no compilation errors.

To test it on your Android phone:
1. Start your backend server.
2. Set EXPO_PUBLIC_API_URL to your computer's IP address in the app's .env file.
3. Open the app/ folder and run npm install if needed.
4. Run npx expo start.
5. Open Expo Go on your phone and scan the QR code.

## 2026-11-16: Phase 0, safe area and friendly errors

The Rota app was updated to fix the status screen layout. It now respects the phone's safe areas, so content does not overlap with the status bar or navigation bar.

The error messages were also improved. Instead of showing technical errors, the app now displays simple messages that users can understand, depending on the problem.

When the server returns a 503 error, the app identifies which service is unavailable, such as PostgreSQL or Redis. This helps users understand what is wrong.

Technical error details are only logged in the development console. They are not displayed to users or logged in production.

Finally, the Retry button and pull-to-refresh feature were kept. TypeScript and styling checks were also included to ensure the code follows the project's rules.

In simple terms: This task made the app's screen display properly on phones and improved how it communicates errors to users without exposing technical information.

## 2026-11-18: Phase 1, database tables and migrations

This task focused on setting up the database structure for the Rota project. The tables were divided into two groups: shared data, such as users and refresh tokens, and team-related data, such as teams and memberships.

The tables were designed to support future database sharding. Instead of using foreign keys to connect records across different groups, UUIDs were used. This means the application will need to check that related users and teams actually exist.

A migration system was also created to manage database changes. It generates separate migrations for each database group and keeps track of which migrations have already been applied.

A script was added to run the migrations safely and repeatedly without creating duplicate records or applying the same changes twice.

Finally, the database was checked to confirm that the tables were created successfully. A decision was also documented to explain why cross-group foreign keys were avoided in preparation for future sharding.

In simple terms: This task prepared the database foundation for Rota. It created the tables, organized them for future scaling, added a safe way to update the database, and documented why the structure was designed this way. No actual app functionality was built yet.

## 2026-11-20: Phase 1, basic authentication

This task added the basic authentication system to Rota. Users can now create an account, log in, and access a protected /me endpoint to confirm their identity.

Passwords are securely hashed before being stored in the database. Access tokens are also signed to prove that a user is logged in without exposing their password.

Redis rate limiting was added to protect the authentication endpoints from repeated login attempts and password-guessing attacks.

The system was built with separate libraries, services, repositories, routes, and middleware to keep the code organized and easier to maintain. Tests were also added using fake services, followed by checks against real PostgreSQL and Redis.

Finally, the implementation was documented, and decisions about the authentication setup were recorded.

In simple terms: This task allows users to create accounts, log in, and access protected information securely. It also helps prevent attackers from guessing passwords.

Note: Features such as refresh tokens, user roles, teams, invitations, and password resets were not included because they belong to later development phases.

## 2026-11-20: Phase 1, flaky tampered-token test

The issue was with a test, not the actual authentication system. The old test changed a character in the token's signature, but sometimes the change did not affect the actual data being verified. This allowed an invalid test case to pass.

The test was fixed so that it now changes a character that genuinely affects the signed data. This ensures the token verification test works reliably every time.

To fix it, a valid token is first created, then different Base64URL characters are tested to find a position where changing the character always makes the token invalid.

In simple terms: This task fixed a faulty test that was not properly detecting changes to a token. The production authentication code was not changed, so there was no production security bug.
