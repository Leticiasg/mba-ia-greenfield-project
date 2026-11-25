import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { User } from '../../src/users/entities/user.entity';

/** Boots AppModule reproducing main.ts global config (pipes + filters). */
export async function createE2eApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  accessToken: string;
}

/**
 * Registers a user through the API, confirms it directly in the DB and logs
 * in. Clears the in-memory throttler so repeated setup never hits the auth
 * rate limit.
 */
export async function createAuthenticatedUser(
  app: INestApplication<App>,
): Promise<AuthenticatedUser> {
  app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  const email = `e2e_${randomUUID().slice(0, 12)}@example.com`;
  const password = 'password123';

  const registered = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const userId = (registered.body as { id: string }).id;

  await app
    .get(DataSource)
    .getRepository(User)
    .update({ id: userId }, { is_confirmed: true });

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    userId,
    email,
    accessToken: (login.body as { access_token: string }).access_token,
  };
}
