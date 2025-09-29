import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from './app.minimal.js';

describe('Minimal User Management API', () => {
  beforeEach(() => {
    // No-op: in-memory state is reset per test run
  });

  it('should create a user', async () => {
    const res = await request(app)
      .post('/users')
      .send({ id: 'u1', email: 'test@example.com', name: 'Test User' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'u1', email: 'test@example.com', name: 'Test User' });
  });

  it('should not create a user with missing id/email', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'No Email' });
    expect(res.status).toBe(400);
  });

  it('should connect a plugin to a user', async () => {
    await request(app).post('/users').send({ id: 'u2', email: 'u2@example.com' });
    const res = await request(app)
      .post('/users/u2/plugins')
      .send({ pluginId: 'p1', config: { foo: 'bar' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('should list user plugins', async () => {
    await request(app).post('/users').send({ id: 'u3', email: 'u3@example.com' });
    await request(app).post('/users/u3/plugins').send({ pluginId: 'p2', config: {} });
    const res = await request(app).get('/users/u3/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toContain('p2');
  });
});