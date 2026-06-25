import { BrowserHostConnection } from "./BrowserHostConnection.ts";
import { BrowserKernel } from "./BrowserKernel.ts";

export class BrowserHost {
  readonly kernel = new BrowserKernel();
  readonly connection: BrowserHostConnection;

  constructor(appRunId: string) {
    this.connection = new BrowserHostConnection(appRunId, (command) =>
      this.kernel.execute(command),
    );
    this.kernel.setEventSink((event) => this.connection.publishEvent(event));
  }

  start(input: { readonly wsBaseUrl: string; readonly token: string }): Promise<void> {
    return this.connection.start(input);
  }

  stop(): Promise<void> {
    return this.connection.stop();
  }
}
