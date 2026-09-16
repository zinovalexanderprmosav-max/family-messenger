export type BootstrapResponse={familyId:string;memberId:string;deviceId:string;familyChatId:string;keyVersion:1;csrfToken:string};
export type InvitationResponse={invitationId:string;joinToken:string;expiresAt:string};
export type AcceptResponse={familyId:string;memberId:string;deviceId:string;familyChatId:string;status:'pending_key';csrfToken:string};
export type PendingDevice={deviceId:string;memberId:string;memberDisplayName:string;deviceName:string;encryptionPublicKey:string;createdAt:string};
