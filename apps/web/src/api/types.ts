export type BootstrapResponse={familyId:string;memberId:string;deviceId:string;familyChatId:string;keyVersion:1;csrfToken:string};
export type InvitationResponse={invitationId:string;joinToken:string;expiresAt:string};
export type AcceptResponse={familyId:string;memberId:string;deviceId:string;familyChatId:string;status:'pending_key';csrfToken:string};
export type PendingDevice={deviceId:string;memberId:string;memberDisplayName:string;deviceName:string;encryptionPublicKey:string;createdAt:string};
export type DeviceEnrollmentResponse={enrollmentId:string;enrollmentToken:string;expiresAt:string};
export type DeviceEnrollmentInspectResponse={enrollmentId:string;familyId:string;memberId:string;familyDisplayName:string;memberDisplayName:string;expiresAt:string};
export type AcceptDeviceEnrollmentResponse={enrollmentId:string;familyId:string;memberId:string;deviceId:string;familyChatId:string;status:'pending_key';csrfToken:string};
