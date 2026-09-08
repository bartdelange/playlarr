import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

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
        startedAt: null,
        updatedAt: new Date(),
      },
    );
  }
}
