import { shouldReadReceiptAgain } from './receipt-scan-engine.mjs';
import { receiptRotationAngles } from './receipt-image-quality.mjs';

export function shouldTryAlternateReceiptLayout(parsed, confidence, width, height) {
  return receiptRotationAngles(width, height, parsed).length === 0 && shouldReadReceiptAgain(parsed, confidence);
}

// Un nombre fixe de passages protège la batterie et évite qu'un ticket illisible
// enchaîne indéfiniment des traitements de plus en plus lents.
export function createReceiptRecoveryBudget(maxPasses = 4) {
  const limit = Math.max(0, Math.min(8, Math.trunc(maxPasses) || 0));
  let used = 0;
  return {
    get used() { return used; },
    get remaining() { return limit - used; },
    async recognize(worker, image, options) {
      if (used >= limit) return null;
      used++;
      return worker.recognize(image, options);
    }
  };
}
