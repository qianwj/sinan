import readline from "node:readline";

export class Application {
  private running = true;
  private rl?: readline.Interface;

  constructor() {
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
    // const result = this.database.migrate();
    // if (result.applied.length > 0) {
    //   console.log(`database migrated: ${result.previousVersion} -> ${result.currentVersion}`);
    // } else {
    //   console.log(`database already at version ${result.currentVersion}`);
    // }
  }

  private async onStop(): Promise<void> {
    console.log('application stopping...');
    if (this.rl) {
      this.rl.close();
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
