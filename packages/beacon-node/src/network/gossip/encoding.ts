import {compress, uncompress} from "snappyjs";
import {Message} from "@libp2p/interface-pubsub";
import {digest} from "@chainsafe/as-sha256";
import {intToBytes} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {GossipTopicCache} from "./topic.js";

/**
 * The function used to generate a gossipsub message id
 * We use the first 8 bytes of SHA256(data) for content addressing
 */
export function fastMsgIdFn(rpcMsg: RPC.IMessage): string {
  if (rpcMsg.data) {
    const h = digest(rpcMsg.data);
    // create intermediate could lead to heap memory issue
    // use 8 bits as number could lead to base64Slice() strange error,
    // this narrows down to 16 charactors: 0 to 9 and : ; < = > ?
    // (0 map to char code 48)
    return String.fromCharCode(
      ((h[0] & 0xf0) >> 4) + 48,
      (h[0] & 0x0f) + 48,
      ((h[1] & 0xf0) >> 4) + 48,
      (h[1] & 0x0f) + 48,
      ((h[2] & 0xf0) >> 4) + 48,
      (h[2] & 0x0f) + 48,
      ((h[3] & 0xf0) >> 4) + 48,
      (h[3] & 0x0f) + 48,
      ((h[4] & 0xf0) >> 4) + 48,
      (h[4] & 0x0f) + 48,
      ((h[5] & 0xf0) >> 4) + 48,
      (h[5] & 0x0f) + 48,
      ((h[6] & 0xf0) >> 4) + 48,
      (h[6] & 0x0f) + 48,
      ((h[7] & 0xf0) >> 4) + 48,
      (h[7] & 0x0f) + 48
    );
  } else {
    return "0000000000000000";
  }
}

export function msgIdToStrFn(msgId: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  return Buffer.prototype.toString.call(msgId, "base64");
}

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let vec: Uint8Array[];

  switch (topic.fork) {
    // message id for phase0.
    // ```
    // SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
    // ```
    case ForkName.phase0:
      vec = [MESSAGE_DOMAIN_VALID_SNAPPY, msg.data];
      break;

    // message id for altair.
    // ```
    // SHA256(
    //   MESSAGE_DOMAIN_VALID_SNAPPY +
    //   uint_to_bytes(uint64(len(message.topic))) +
    //   message.topic +
    //   snappy_decompress(message.data)
    // )[:20]
    // ```
    // https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.7/specs/altair/p2p-interface.md#topics-and-messages
    case ForkName.altair:
    case ForkName.bellatrix: {
      vec = [MESSAGE_DOMAIN_VALID_SNAPPY, intToBytes(msg.topic.length, 8), Buffer.from(msg.topic), msg.data];
      break;
    }
  }

  return Buffer.from(digest(Buffer.concat(vec))).subarray(0, 20);
}

export class DataTransformSnappy {
  constructor(private readonly maxSizePerMessage: number) {}

  /**
   * Takes the data published by peers on a topic and transforms the data.
   * Should be the reverse of outboundTransform(). Example:
   * - `inboundTransform()`: decompress snappy payload
   * - `outboundTransform()`: compress snappy payload
   */
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    // No need to parse topic, everything is snappy compressed
    return uncompress(data, this.maxSizePerMessage);
  }
  /**
   * Takes the data to be published (a topic and associated data) transforms the data. The
   * transformed data will then be used to create a `RawGossipsubMessage` to be sent to peers.
   */
  outboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    if (data.length > this.maxSizePerMessage) {
      throw Error(`ssz_snappy encoded data length ${length} > ${this.maxSizePerMessage}`);
    }
    // No need to parse topic, everything is snappy compressed
    return compress(data);
  }
}
