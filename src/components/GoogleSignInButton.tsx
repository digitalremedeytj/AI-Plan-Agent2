import React from "react";

// "Sign in with Google" through Google Identity Services, loaded as a script rather than an npm
// package (see CLAUDE.md on dependencies). One Tap with auto-select signs someone in without a
// click when their browser profile is already signed in to one Digital Remedy Google account; the
// button is there for everyone else. The server verifies the credential (POST /api/auth/google).

const GIS_SRC = "https://accounts.google.com/gsi/client";

declare global {
  interface Window {
    google?: any;
  }
}

let gisLoad: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoad = null;
      reject(new Error("Google sign-in could not be loaded. Check your connection or ad blocker."));
    };
    document.head.appendChild(script);
  });
  return gisLoad;
}

/**
 * Stops One Tap signing the same account straight back in after someone signs out. Google keeps
 * this per browser until the next deliberate sign-in.
 */
export function disableGoogleAutoSelect(): void {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    // Not loaded on this page: nothing to disable.
  }
}

export function GoogleSignInButton({
  clientId,
  hostedDomain,
  onCredential,
  onError,
}: {
  clientId: string;
  hostedDomain?: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const buttonRef = React.useRef<HTMLDivElement>(null);
  // Held in refs so a parent re-render does not re-initialise Google and re-prompt One Tap.
  const handlers = React.useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  React.useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        const id = window.google.accounts.id;
        id.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (response.credential) handlers.current.onCredential(response.credential);
            else handlers.current.onError("Google did not return a sign-in. Please try again.");
          },
          auto_select: true,
          // Only a hint for which account to offer; the server enforces the domain.
          hd: hostedDomain,
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          context: "signin",
        });
        id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: 320, logo_alignment: "center" });
        id.prompt();
      })
      .catch((err) => !cancelled && handlers.current.onError(err.message));
    return () => {
      cancelled = true;
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        // Already gone.
      }
    };
  }, [clientId, hostedDomain]);

  return <div ref={buttonRef} className="flex min-h-[44px] justify-center" />;
}
