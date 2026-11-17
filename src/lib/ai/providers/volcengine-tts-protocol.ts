/**
 * OpenSpeech V3 binary frame protocol (Seed TTS WebSocket).
 * Shared by unidirectional stream + bidirectional variants.
 */

export enum MsgType {
  Invalid = 0,
  FullClientRequest = 0b0001,
  AudioOnlyClient = 0b0010,
  FullServerResponse = 0b1001,
  AudioOnlyServer = 0b1011,
  FrontEndResultServer = 0b1100,
  Error = 0b1111,
}

export enum MsgTypeFlagBits {
  NoSeq = 0b0000,
  PositiveSeq = 0b0001,
  LastNoSeq = 0b0010,
  NegativeSeq = 0b0011,
  WithEvent = 0b0100,
}

export enum EventType {
  None = 0,
  StartConnection = 1,
  FinishConnection = 2,
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  StartSession = 100,
  CancelSession = 101,
  FinishSession = 102,
  SessionStarted = 150,
  SessionCanceled = 151,
  SessionFinished = 152,
  SessionFailed = 153,
  UsageResponse = 154,
  TaskRequest = 200,
  TTSSentenceStart = 350,
  TTSSentenceEnd = 351,
  TTSResponse = 352,
}

export type OpenSpeechMessage = {
  type: MsgType;
  flag: MsgTypeFlagBits;
  event: EventType;
  sessionId: string;
  connectId: string;
  sequence: number;
  errorCode: number;
  payload: Buffer;
};

const VERSION = 1;
const HEADER_SIZE_UNITS = 1; // 4 bytes
const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_NONE = 0;

function writeU32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function writeI32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n | 0, 0);
  return b;
}

/** FullClientRequest with NoSeq — used by unidirectional/stream. */
export function marshalFullClientRequest(payload: Buffer | string): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  const header = Buffer.from([
    (VERSION << 4) | HEADER_SIZE_UNITS,
    (MsgType.FullClientRequest << 4) | MsgTypeFlagBits.NoSeq,
    (SERIALIZATION_JSON << 4) | COMPRESSION_NONE,
    0,
  ]);
  return Buffer.concat([header, writeU32BE(body.length), body]);
}

function shouldReadSessionId(event: EventType): boolean {
  return !(
    event === EventType.StartConnection ||
    event === EventType.FinishConnection ||
    event === EventType.ConnectionStarted ||
    event === EventType.ConnectionFailed ||
    event === EventType.ConnectionFinished
  );
}

function shouldReadConnectId(event: EventType): boolean {
  return (
    event === EventType.ConnectionStarted ||
    event === EventType.ConnectionFailed ||
    event === EventType.ConnectionFinished
  );
}

export function unmarshalMessage(data: Buffer): OpenSpeechMessage {
  if (data.length < 4) {
    throw new Error(`OpenSpeech frame too short: ${data.length}`);
  }

  const typeAndFlag = data[1]!;
  const type = (typeAndFlag >> 4) as MsgType;
  const flag = (typeAndFlag & 0x0f) as MsgTypeFlagBits;
  const headerSize = 4 * (data[0]! & 0x0f);

  let offset = headerSize;
  let sequence = 0;
  let errorCode = 0;
  let event = EventType.None;
  let sessionId = "";
  let connectId = "";

  const needSeq =
    flag === MsgTypeFlagBits.PositiveSeq ||
    flag === MsgTypeFlagBits.NegativeSeq;

  if (
    type === MsgType.FullClientRequest ||
    type === MsgType.FullServerResponse ||
    type === MsgType.FrontEndResultServer ||
    type === MsgType.AudioOnlyClient ||
    type === MsgType.AudioOnlyServer
  ) {
    if (needSeq) {
      sequence = data.readInt32BE(offset);
      offset += 4;
    }
  } else if (type === MsgType.Error) {
    errorCode = data.readUInt32BE(offset);
    offset += 4;
  } else {
    throw new Error(`Unsupported OpenSpeech MsgType: ${type}`);
  }

  if (flag === MsgTypeFlagBits.WithEvent) {
    event = data.readInt32BE(offset) as EventType;
    offset += 4;
    if (shouldReadSessionId(event)) {
      const sidLen = data.readUInt32BE(offset);
      offset += 4;
      if (sidLen > 0) {
        sessionId = data.subarray(offset, offset + sidLen).toString("utf8");
        offset += sidLen;
      }
    }
    if (shouldReadConnectId(event)) {
      const cidLen = data.readUInt32BE(offset);
      offset += 4;
      if (cidLen > 0) {
        connectId = data.subarray(offset, offset + cidLen).toString("utf8");
        offset += cidLen;
      }
    }
  }

  const payloadLen = data.readUInt32BE(offset);
  offset += 4;
  const payload =
    payloadLen > 0 ? Buffer.from(data.subarray(offset, offset + payloadLen)) : Buffer.alloc(0);

  return {
    type,
    flag,
    event,
    sessionId,
    connectId,
    sequence,
    errorCode,
    payload,
  };
}

export function describeMessage(msg: OpenSpeechMessage): string {
  if (msg.type === MsgType.AudioOnlyServer || msg.type === MsgType.AudioOnlyClient) {
    return `AudioOnly event=${msg.event} size=${msg.payload.length}`;
  }
  if (msg.type === MsgType.Error) {
    return `Error code=${msg.errorCode} ${msg.payload.toString("utf8").slice(0, 200)}`;
  }
  return `type=${msg.type} event=${msg.event} payload=${msg.payload.toString("utf8").slice(0, 120)}`;
}
