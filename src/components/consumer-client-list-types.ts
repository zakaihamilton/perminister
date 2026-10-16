export type ConsumerClientManagementAction = "rotate" | "revoke";

export interface ConsumerClientConfirmation {
  action: ConsumerClientManagementAction;
  clientId: string;
}
