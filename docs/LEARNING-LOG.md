# Learning Log

## 2026-11-14: Phase 0, server foundation

Set up the project folder using npm init -y, which creates `package.json`. This file acts as an ID card and instruction sheet for the backend folder. It holds the name, the scripts, and the list of packages needed, and npm install downloaded those packages. I learned that TypeScript strict mode is a compiler setting that activates a bundle of rigorous type-checking rules to catch bugs during development. It is a strict teacher that catches mistakes early. dotenv reads the root `.env` file and copies its values into `process.env` in Node.js applications, and Zod helps with runtime data checking. I also learnt the difference between npm run dev and npm run build: npm run dev runs the TypeScript directly and restarts the server when a file changes for live coding, while npm run build compiles the code into plain JavaScript in `dist` with `tsc` and does not optimize or minify anything. Both commands execute scripts defined inside your project's `package.json` file. The part that got confusing for me was understanding what a `/health` check was, but I now understand it as a route: a rule that maps a request to a response. The `/health` route specifically checks whether the service is running and answering requests, not whether it can handle heavy traffic.

## 2026-11-14: Phase 0, testable app and lint

The Express application was moved into a separate file called `app.ts`. This file now contains and exports the app, while `index.ts` is only responsible for loading the environment and starting the server.

A test was added using Vitest to check if the `/health` route works correctly. The test starts the server on a free port, sends a request, checks the response status and message, and then closes the server.

ESLint was also added to the project to help identify common coding mistakes. It checks the code in the `src/` folder using recommended JavaScript and TypeScript rules.

The main reason for these changes is to make the application easier to test and maintain. Separating the app from the server startup allows tests to run without automatically starting the main server.

One small ESLint customization was added to ignore unused parameters that start with an underscore. This helps avoid unnecessary warnings when a parameter is intentionally not used.
