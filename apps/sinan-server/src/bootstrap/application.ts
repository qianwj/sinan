import readline from "node:readline";
import { ActorManager } from "../actors/manager.js";
import { Database, Migrator } from "../persistence/database.js";
import {
    ActorRoutes,
    ErrorMapper,
    EventStreamHandler,
    HealthRoutes,
    HttpServer,
    IdempotencyStore,
    Router,
} from "../http/index.js";

export class Application {
    private running = true;
    private rl?: readline.Interface;
    private readonly database: Database;
    private readonly actorManager: ActorManager;
    private readonly httpServer: HttpServer;
    private readonly idempotency: IdempotencyStore;

    constructor() {
        this.database = new Database();
        this.actorManager = new ActorManager(this.database);
        this.idempotency = new IdempotencyStore();

        const router = new Router(
            [
                ...new ActorRoutes(this.actorManager, this.idempotency).routes,
                ...new HealthRoutes(this.actorManager).routes,
                ...new EventStreamHandler().routes,
            ],
            new ErrorMapper(),
        );
        this.httpServer = new HttpServer(router);
    }

    public async run(): Promise<void> {
        try {
            await this.onStart();
            this.setupSignalListeners();
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            console.log('Application started. exit on ctrl+c');
        } catch (e) {
            console.error('Application started failed. cause:', e);
            process.exit(1);
        }
    }

    private async onStart(): Promise<void> {
        console.log('application starting...');
        const result = new Migrator(this.database).migrate();
        if (result.applied.length > 0) {
            console.log(`database migrated: ${result.previousVersion} -> ${result.currentVersion}`);
        } else {
            console.log(`database already at version ${result.currentVersion}`);
        }
        // Per `actor-runtime.md` §8.5 step 5: HTTP/SSE must not start serving
        // before actor recovery completes. Otherwise a client could observe
        // actors whose state has not yet been reconciled.
        const report = await this.actorManager.reload();
        if (report.resumed.length > 0) {
            console.log(`actor recovery: resumed ${report.resumed.length}`);
        }
        if (report.quarantined.length > 0) {
            console.warn(
                `actor recovery: quarantined ${report.quarantined.length}: ` +
                report.quarantined.map((q) => `${q.id} (${q.reason})`).join(", "),
            );
        }
        if (report.orphans.length > 0) {
            console.warn(`actor recovery: orphan event ids: ${report.orphans.join(", ")}`);
        }
        if (report.missingConfigs.length > 0) {
            console.warn(`actor recovery: missing-config ids: ${report.missingConfigs.join(", ")}`);
        }
        await this.httpServer.start();
    }

    private async onStop(): Promise<void> {
        console.log('application stopping...');
        if (this.rl) {
            this.rl.close();
        }
        try {
            this.actorManager.dispose();
        } finally {
            this.database.close();
            await this.httpServer.stop();
        }
    }

    private setupSignalListeners(): void {
        ['SIGTERM', 'SIGINT'].forEach((signal) => {
            process.on(signal, async () => {
                if (!this.running) return;
                this.running = false;
                console.log(`received signal: ${signal}`);
                await this.onStop();
                process.exit(0);
            })
        })
    }
}
