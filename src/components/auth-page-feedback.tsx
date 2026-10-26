export function AuthPageFeedback({
  error,
  errorText,
  notice,
  noticeText,
  invitationMessage,
}: {
  error?: string;
  errorText: Readonly<Record<string, string>>;
  notice?: string;
  noticeText?: Readonly<Record<string, string>>;
  invitationMessage?: string;
}) {
  return (
    <>
      {invitationMessage ? (
        <p className="form-success" role="status">
          {invitationMessage}
        </p>
      ) : null}
      {error && errorText[error] ? (
        <p className="form-error" role="alert">
          {errorText[error]}
        </p>
      ) : null}
      {notice && noticeText?.[notice] ? (
        <p className="form-success" role="status">
          {noticeText[notice]}
        </p>
      ) : null}
    </>
  );
}
