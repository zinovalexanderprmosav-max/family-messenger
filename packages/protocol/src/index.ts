import { z } from 'zod';

export const Id = z.string().uuid();
export const Base64 = z.string().min(1);
export const DisplayName = z.string().trim().min(1).max(80);
export const DeviceName = z.string().trim().min(1).max(100);

export const BootstrapFamilyRequest = z.object({
  familyDisplayName: DisplayName,
  memberDisplayName: DisplayName,
  deviceName: DeviceName,
  encryptionPublicKey: Base64,
  signingPublicKey: Base64,
  initialFamilyChatKeyEnvelope: Base64
});

export const CreateInvitationResponse = z.object({
  invitationId: Id,
  joinToken: z.string().min(32),
  expiresAt: z.string().datetime()
});

export const InvitationTokenRequest = z.object({ joinToken: z.string().min(32) });

export const AcceptInvitationRequest = InvitationTokenRequest.extend({
  memberDisplayName: DisplayName,
  deviceName: DeviceName,
  encryptionPublicKey: Base64,
  signingPublicKey: Base64
});

export const ApproveDeviceRequest = z.object({
  chatId: Id,
  keyVersion: z.number().int().positive(),
  sealedKeyEnvelope: Base64
});

export const KeyRotationDeviceSchema = z.object({
  deviceId: Id,
  memberId: Id,
  encryptionPublicKey: Base64
});

export const KeyRotationStatusResponseSchema = z.union([
  z.object({status:z.literal('not_required')}),
  z.object({
    status:z.literal('required'),
    chatId:Id,
    fromKeyVersion:z.number().int().positive(),
    nextKeyVersion:z.number().int().positive(),
    devices:z.array(KeyRotationDeviceSchema).min(1)
  })
]);

export const CompleteKeyRotationRequestSchema = z.object({
  fromKeyVersion:z.number().int().positive(),
  nextKeyVersion:z.number().int().positive(),
  envelopes:z.array(z.object({
    deviceId:Id,
    sealedKeyEnvelope:Base64
  })).min(1)
});

export const EncryptedMessageEnvelopeSchema = z.object({
  messageId: Id,
  chatId: Id,
  senderDeviceId: Id,
  keyVersion: z.number().int().positive(),
  nonce: Base64,
  ciphertext: Base64
});

export const StoredMessageEnvelopeSchema = EncryptedMessageEnvelopeSchema.extend({
  sequence: z.string().regex(/^\d+$/),
  acceptedAt: z.string().datetime()
});

export const AuthChallengeRequest = z.object({ deviceId: Id });
export const AuthCompleteRequest = z.object({
  challengeId: Id,
  deviceId: Id,
  signature: Base64
});

export const RealtimeEventSchema = z.object({
  type: z.literal('reconcile.required'),
  chatId: Id,
  latestSequence: z.string().regex(/^\d+$/)
});

export type KeyRotationDevice = z.infer<typeof KeyRotationDeviceSchema>;
export type KeyRotationStatusResponse = z.infer<typeof KeyRotationStatusResponseSchema>;
export type CompleteKeyRotationRequest = z.infer<typeof CompleteKeyRotationRequestSchema>;
export type EncryptedMessageEnvelope = z.infer<typeof EncryptedMessageEnvelopeSchema>;
export type StoredMessageEnvelope = z.infer<typeof StoredMessageEnvelopeSchema>;
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
