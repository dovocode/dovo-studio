import { Client, credentials, Metadata } from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import type { z } from 'zod'

// Use the upstream protobuf and gRPC implementations; validate native replies at the boundary.
export class SimulatorRpc {
  readonly client: Client
  private readonly root: protobuf.Root
  readonly metadata = new Metadata()
  constructor(
    address: string,
    protocol: string,
    private readonly prefix: string,
    token?: string,
  ) {
    this.client = new Client(address, credentials.createInsecure(), {
      'grpc.max_receive_message_length': 32 * 1024 * 1024,
    })
    this.root = protobuf.parse(protocol).root
    if (token) this.metadata.set('authorization', `Bearer ${token}`)
  }
  ready() {
    return new Promise<void>((resolve, reject) =>
      this.client.waitForReady(Date.now() + 15000, (error) => (error ? reject(error) : resolve())),
    )
  }
  private encode(name: string) {
    const type = this.root.lookupType(name)
    return (value: object) => Buffer.from(type.encode(type.fromObject(value)).finish())
  }
  private decode<T>(name: string, schema: z.ZodType<T>) {
    const type = this.root.lookupType(name)
    return (value: Buffer): T =>
      schema.parse(
        type.toObject(type.decode(value), { longs: Number, bytes: Buffer, defaults: true }),
      )
  }
  unary<T>(
    method: string,
    requestType: string,
    responseType: string,
    request: object,
    schema: z.ZodType<T>,
  ) {
    return new Promise<T>((resolve, reject) => {
      this.client.makeUnaryRequest(
        `/${this.prefix}/${method}`,
        this.encode(requestType),
        this.decode(responseType, schema),
        request,
        this.metadata,
        { deadline: Date.now() + 10000 },
        (error, value) => {
          if (error) reject(error)
          else if (value === undefined) reject(new Error('Empty simulator response'))
          else resolve(value)
        },
      )
    })
  }
  stream<T>(
    method: string,
    requestType: string,
    responseType: string,
    request: object,
    schema: z.ZodType<T>,
  ) {
    return this.client.makeServerStreamRequest(
      `/${this.prefix}/${method}`,
      this.encode(requestType),
      this.decode(responseType, schema),
      request,
      this.metadata,
    )
  }
  duplex<T>(method: string, requestType: string, responseType: string, schema: z.ZodType<T>) {
    return this.client.makeBidiStreamRequest(
      `/${this.prefix}/${method}`,
      this.encode(requestType),
      this.decode(responseType, schema),
      this.metadata,
    )
  }
  writeStream<T>(
    method: string,
    requestType: string,
    responseType: string,
    schema: z.ZodType<T>,
    done: (error: Error | null) => void,
  ) {
    return this.client.makeClientStreamRequest(
      `/${this.prefix}/${method}`,
      this.encode(requestType),
      this.decode(responseType, schema),
      this.metadata,
      (error) => done(error),
    )
  }
  close() {
    this.client.close()
  }
}
