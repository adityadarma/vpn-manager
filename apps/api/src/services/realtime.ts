import type { FastifyInstance } from 'fastify'

export interface RealtimeEvent {
  type: string
  entityId?: string
  occurredAt: string
}

type Subscriber = (event: RealtimeEvent) => void

export class RealtimeEvents {
  private readonly subscribers = new Set<Subscriber>()

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  publish(type: string, entityId?: string): void {
    const event = { type, entityId, occurredAt: new Date().toISOString() }
    for (const subscriber of this.subscribers) subscriber(event)
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeEvents
  }
}

export function registerRealtimeEvents(app: FastifyInstance): void {
  app.decorate('realtime', new RealtimeEvents())
}
