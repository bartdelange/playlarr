import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class CommandRuntimeLifecycle {
  private acceptingWork = true;

  stopAcceptingWork(): void {
    this.acceptingWork = false;
  }

  assertAcceptingWork(): void {
    if (!this.acceptingWork) {
      throw new ServiceUnavailableException(
        'Playlarr is shutting down and is not accepting new commands',
      );
    }
  }

  isAcceptingWork(): boolean {
    return this.acceptingWork;
  }
}
