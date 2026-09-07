import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OTPInput, type OTPStatus } from "@/components/otp/OTPInput";
import { Modal } from "@/components/ui/Modal";
import { ipc } from "@/lib/ipc";
import { lockDisplayName, useLocks } from "@/stores/locks";
import { useVault } from "@/stores/vault";

type Step = "current" | "new" | "confirm" | "unlock";

export function LockDialog() {
  const dialog = useLocks((s) => s.dialog);
  const closeDialog = useLocks((s) => s.closeDialog);
  const isLocked = useLocks((s) => s.isLocked);
  const setPin = useLocks((s) => s.setPin);
  const removeLock = useLocks((s) => s.remove);

  const [step, setStep] = useState<Step>("unlock");
  const [currentPin, setCurrentPin] = useState<string | undefined>();
  const [newPin, setNewPin] = useState("");
  const [status, setStatus] = useState<OTPStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog) return;
    setCurrentPin(undefined);
    setNewPin("");
    setStatus("idle");
    setErrorMessage(undefined);
    setBusy(false);
    if (dialog.mode === "unlock") setStep("unlock");
    else if (dialog.mode === "remove") setStep("current");
    else setStep(isLocked(dialog.rel) ? "current" : "new");
  }, [dialog, isLocked]);

  if (!dialog) return null;
  const { rel, kind, mode, onUnlocked } = dialog;
  const name = lockDisplayName(rel);

  const fail = (msg: string) => {
    setStatus("error");
    setErrorMessage(msg);
  };

  const submitCurrent = async (pin: string) => {
    setBusy(true);
    setStatus("idle");
    try {
      const ok = await ipc.lockVerify(rel, pin);
      if (!ok) {
        fail("Incorrect PIN. Try again.");
        return;
      }
      if (mode === "unlock") {
        closeDialog();
        onUnlocked?.();
        return;
      }
      if (mode === "remove") {
        await removeLock(rel);
        toast.success(`PIN removed for "${name}".`);
        closeDialog();
        return;
      }
      // mode === "manage": current PIN confirmed, move on to setting a new one.
      setCurrentPin(pin);
      setStatus("idle");
      setErrorMessage(undefined);
      setStep("new");
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitNew = (pin: string) => {
    setNewPin(pin);
    setStatus("idle");
    setErrorMessage(undefined);
    setStep("confirm");
  };

  const submitConfirm = async (pin: string) => {
    if (pin !== newPin) {
      fail("PINs didn't match — start over.");
      setNewPin("");
      setStep("new");
      return;
    }
    setBusy(true);
    try {
      await setPin(rel, pin, currentPin);
      useVault.getState().enforceLock(rel);
      toast.success(
        currentPin ? `PIN changed for "${name}".` : `PIN set for "${name}".`,
      );
      closeDialog();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const { title, hint, onComplete } =
    step === "unlock"
      ? {
          title: `Enter PIN for "${name}"`,
          hint: `This ${kind} is protected.`,
          onComplete: submitCurrent,
        }
      : step === "current"
        ? {
            title: `Enter the current PIN for "${name}"`,
            hint:
              mode === "remove"
                ? "Removing the PIN doesn't need a new one — just confirm the current one."
                : "Confirm the current PIN before setting a new one.",
            onComplete: submitCurrent,
          }
        : step === "new"
          ? {
              title: currentPin ? "Choose a new PIN" : `Set a PIN for "${name}"`,
              hint: "4 digits.",
              onComplete: submitNew,
            }
          : {
              title: "Confirm the new PIN",
              hint: "Enter it once more to make sure.",
              onComplete: submitConfirm,
            };

  return (
    <Modal
      open={Boolean(dialog)}
      onClose={closeDialog}
      ariaLabel={title}
      className="w-[380px]"
    >
      <div className="flex flex-col items-center gap-4 px-6 py-7">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-panel text-muted">
          <Lock size={16} strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
        </div>
        <OTPInput
          key={step}
          length={4}
          status={status}
          errorMessage={errorMessage}
          hint={busy ? undefined : hint}
          disabled={busy}
          autoFocus
          aria-label={title}
          onComplete={(value) => void onComplete(value)}
        />
      </div>
    </Modal>
  );
}
