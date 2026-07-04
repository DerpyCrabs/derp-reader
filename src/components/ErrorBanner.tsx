import X from "lucide-solid/icons/x";

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div class="error-banner" role="alert">
      <span>{props.message}</span>
      <button class="error-dismiss icon-button" data-testid="dismiss-error" title="Dismiss error" onClick={props.onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
