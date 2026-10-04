import { randomUUID } from 'node:crypto';

import { MikroORM, raw } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';

import { CommandEntity } from './command.entity.js';

@Injectable()
export class CommandRepository {
  constructor(private readonly orm: MikroORM) {}

  async create(type: string, payload: unknown): Promise<CommandEntity> {
    const em = this.orm.em.fork();

    const command = em.create(CommandEntity, {
      id: randomUUID(),
      type,
      payloadJson: payload,
      status: 'queued',
      current: 0,
      total: 0,
      attempts: 0,
      revision: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    em.persist(command);
    await em.flush();

    return command;
  }

  async findById(id: string): Promise<CommandEntity | null> {
    return this.orm.em.fork().findOne(CommandEntity, { id });
  }

  async findStateById(id: string): Promise<CommandState | null> {
    const command = await this.findById(id);

    return command ? this.toState(command) : null;
  }

  async updateProgress(
    id: string,
    current: number,
    total: number,
    currentItem?: string,
  ): Promise<void> {
    const now = new Date();

    await this.orm.em.fork().nativeUpdate(
      CommandEntity,
      { id, status: 'running' },
      {
        current,
        total,
        currentItem,
        revision: raw('revision + 1'),
        updatedAt: now,
      },
    );
  }

  async complete(id: string): Promise<void> {
    const now = new Date();

    await this.orm.em.fork().nativeUpdate(
      CommandEntity,
      { id, status: 'running' },
      {
        status: 'completed',
        completedAt: now,
        revision: raw('revision + 1'),
        updatedAt: now,
      },
    );
  }

  async fail(id: string, error: string): Promise<void> {
    const now = new Date();

    await this.orm.em.fork().nativeUpdate(
      CommandEntity,
      { id, status: 'running' },
      {
        status: 'failed',
        error,
        completedAt: now,
        revision: raw('revision + 1'),
        updatedAt: now,
      },
    );
  }

  async claimNext(): Promise<CommandEntity | null> {
    const em = this.orm.em.fork();

    return em.transactional(async (tx) => {
      while (true) {
        const candidate = await tx.findOne(
          CommandEntity,
          { status: 'queued' },
          { orderBy: { createdAt: 'ASC' } },
        );

        if (!candidate) {
          return null;
        }

        const now = new Date();

        const claimed = await tx.nativeUpdate(
          CommandEntity,
          {
            id: candidate.id,
            status: 'queued',
          },
          {
            status: 'running',
            attempts: candidate.attempts + 1,
            revision: raw('revision + 1'),
            startedAt: now,
            updatedAt: now,
          },
        );

        if (claimed === 1) {
          tx.clear();

          return tx.findOneOrFail(CommandEntity, {
            id: candidate.id,
          });
        }

        tx.clear();
      }
    });
  }

  async findRunning(): Promise<CommandEntity[]> {
    return this.orm.em
      .fork()
      .find(
        CommandEntity,
        { status: 'running' },
        { orderBy: { createdAt: 'ASC' } },
      );
  }

  async requeue(id: string): Promise<void> {
    const em = this.orm.em.fork();

    await em.nativeUpdate(
      CommandEntity,
      {
        id,
        status: 'running',
      },
      {
        status: 'queued',
        revision: raw('revision + 1'),
        startedAt: null,
        updatedAt: new Date(),
      },
    );
  }

  async releaseUnstartedClaim(id: string): Promise<void> {
    const em = this.orm.em.fork();

    await em.nativeUpdate(
      CommandEntity,
      {
        id,
        status: 'running',
      },
      {
        status: 'queued',
        attempts: raw('attempts - 1'),
        revision: raw('revision + 1'),
        startedAt: null,
        updatedAt: new Date(),
      },
    );
  }

  private toState(command: CommandEntity): CommandState {
    return {
      id: command.id,
      type: command.type,
      status: command.status,
      current: command.current,
      total: command.total,
      ...(command.currentItem == null
        ? {}
        : { currentItem: command.currentItem }),
      attempts: command.attempts,
      revision: command.revision,
      ...(command.error == null ? {} : { error: command.error }),
      createdAt: command.createdAt.toISOString(),
      updatedAt: command.updatedAt.toISOString(),
      ...(command.startedAt == null
        ? {}
        : { startedAt: command.startedAt.toISOString() }),
      ...(command.completedAt == null
        ? {}
        : { completedAt: command.completedAt.toISOString() }),
    };
  }
}
