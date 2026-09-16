import type { EncryptedMessageEnvelope } from '@family-messenger/protocol';

export function sameEnvelope(a:EncryptedMessageEnvelope,b:EncryptedMessageEnvelope){
  return a.messageId===b.messageId
    && a.chatId===b.chatId
    && a.senderDeviceId===b.senderDeviceId
    && a.keyVersion===b.keyVersion
    && a.nonce===b.nonce
    && a.ciphertext===b.ciphertext;
}
