import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class CommandWakeSignal {
  private readonly subject = new Subject<void>();

  readonly wake$ = this.subject.asObservable();

  wake(): void {
    this.subject.next();
  }
}
