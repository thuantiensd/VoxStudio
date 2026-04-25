import { createContext, useCallback, useContext, useEffect, useState } from "react";
import UpgradeModal from "./UpgradeModal";
import { setUpgradeOpener } from "../services/errors";

/**
 * UpgradeProvider — mount 1 lần ở root để mọi nơi có thể bật paywall
 * modal qua hook `useUpgrade()` HOẶC qua `showError(...)` (errors.js sẽ
 * tự gọi opener khi gặp lỗi quota).
 */
const UpgradeCtx = createContext({ open: () => {} });

export function UpgradeProvider({ children }) {
  const [paywall, setPaywall] = useState(null); // { reason } | null

  const open = useCallback((reason) => {
    setPaywall({ reason: reason || null });
  }, []);
  const close = useCallback(() => setPaywall(null), []);

  // Đăng ký opener cho errors.showError(): khi catch lỗi quota, layer
  // lỗi tự bật modal mà không cần page wire tay.
  useEffect(() => {
    setUpgradeOpener(open);
    return () => setUpgradeOpener(null);
  }, [open]);

  return (
    <UpgradeCtx.Provider value={{ open }}>
      {children}
      <UpgradeModal
        open={!!paywall}
        onClose={close}
        reason={paywall?.reason}
      />
    </UpgradeCtx.Provider>
  );
}

export function useUpgrade() {
  return useContext(UpgradeCtx);
}
