# CHU Mobile Nota Voice, Dual Pricing, and Desktop Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Nota voice for first and repeated barcode scans, independent manual PCS/LSN prices, and one honest frontend-demo archive-and-transfer flow with retry.

**Architecture:** Keep note data and desktop-transfer failure metadata inside `MockOperationsGateway`. Reuse the existing Nota voice player for scan announcements, and keep React components responsible only for form state, progress state, and reader-facing messages.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Electron renderer domain types, Capacitor Android.

## Global Constraints

- Frontend-only and session-only; do not add backend, database, NAS, persistence, or a real desktop receiver.
- Do not claim successful desktop delivery while `MockOperationsGateway` is active.
- Use Indonesian UI copy, integer rupiah, WITA timestamps, and existing Nota voice assets.
- Treat `/Users/hamlet/Documents/CH Nota` as read-only.
- Develop each behavior test-first and run focused tests after each slice.

---

### Task 1: Session-only desktop transfer state

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/gateway/operations-gateway.ts`
- Test: `tests/unit/nota-transactions.test.ts`

**Interfaces:**
- Produces: `NotaDesktopTransferStatus`, optional transfer fields on `NotaTransaction`, `NotaDesktopTransferResult`, and `OperationsGateway.transferNotaToDesktop(id)`.
- Consumes: existing completed `archive` transactions.

- [ ] **Step 1: Write the failing gateway test**

Add a test that completes a transaction into `archive`, captures stock, calls `transferNotaToDesktop`, and asserts:

```ts
await expect(gateway.transferNotaToDesktop(transaction.id)).resolves.toEqual({
  sent: false,
  reason: 'CH Core API belum tersedia.',
});
expect(gateway.getSnapshot().notaTransactions[0]).toMatchObject({
  desktopTransferStatus: 'failed',
  desktopTransferError: 'CH Core API belum tersedia.',
});
expect(gateway.getSnapshot().notaTransactions[0]?.desktopTransferAttemptedAt).toEqual(expect.any(String));
expect(gateway.getSnapshot().skus).toEqual(stockBefore);
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/unit/nota-transactions.test.ts`

Expected: FAIL because `transferNotaToDesktop` and transfer metadata do not exist.

- [ ] **Step 3: Add the transfer types and mock gateway operation**

Add to `NotaTransaction`:

```ts
desktopTransferStatus?: 'failed' | 'sent';
desktopTransferError?: string;
desktopTransferAttemptedAt?: string;
```

Add the gateway result and method:

```ts
export interface NotaDesktopTransferResult {
  sent: boolean;
  reason?: string;
}

transferNotaToDesktop(id: string): Promise<NotaDesktopTransferResult>;
```

The mock implementation accepts only a completed archive note, records `failed`, the exact CH Core API reason, and a new ISO timestamp, then returns `{ sent: false, reason }`. It must not repost stock or revenue.

- [ ] **Step 4: Verify the focused gateway suite**

Run: `npm test -- tests/unit/nota-transactions.test.ts`

Expected: all tests PASS.

### Task 2: Barcode scan Nota voice

**Files:**
- Modify: `mobile/components/MobileNotaView.tsx:90-146`
- Test: `tests/unit/mobile-nota-ui.test.tsx`

**Interfaces:**
- Consumes: `NotaVoicePlayer.speak`, the assigned `Nota` page, `NotaLine`, and `rowPrice`.
- Produces: a voice call after each accepted first or duplicate SKU scan.

- [ ] **Step 1: Extend the barcode UI test**

After the first accepted scan, assert:

```ts
expect(voice.speak).toHaveBeenLastCalledWith({
  rowNumber: 1,
  suffix: 'A',
  quantity: 1,
  unit: 'pcs',
  price: 42_000,
});
```

After scanning the same alias again, assert the same row is reread with `quantity: 2` and `price: 42_000`. Also assert archived and unknown scans do not add voice calls.

- [ ] **Step 2: Verify the barcode test fails**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx`

Expected: FAIL because barcode additions do not call the voice player.

- [ ] **Step 3: Speak after successful barcode mutations**

For duplicates, calculate the row index from `duplicate.page.lines`, increment quantity, then call:

```ts
voicePlayer.current?.speak({
  rowNumber: duplicate.page.lines.findIndex((line) => line.id === duplicate.line.id) + 1,
  suffix: duplicate.page.suffix,
  quantity: duplicate.line.quantity + 1,
  unit: duplicate.line.unit,
  price: rowPrice(duplicate.line),
});
```

For a new SKU, speak the assigned slot with quantity `1`, unit `pcs`, and the stored PCS price after `updateNotaLine` resolves.

- [ ] **Step 4: Verify barcode voice**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx`

Expected: all tests PASS.

### Task 3: Independent manual PCS and LSN prices

**Files:**
- Modify: `mobile/components/MobileNotaView.tsx:12-13,149-184,246-252`
- Modify: `mobile/styles.css:874-885`
- Test: `tests/unit/mobile-nota-ui.test.tsx`
- Test: `tests/unit/mobile-archive-ui.test.tsx`

**Interfaces:**
- Consumes: existing `NotaLine.pcsPrice`, `NotaLine.lsnPrice`, selected manual `unit`, and Nota voice.
- Produces: manual draft fields `pcsPrice` and `lsnPrice`, plus independent inputs `Harga PCS barang manual` and `Harga Lusin barang manual`.

- [ ] **Step 1: Update test helpers and add the dual-price test**

Update manual helpers to fill both price inputs. Add a LSN case that enters PCS `12_500`, LSN `145_000`, quantity `3`, selects LSN, saves, and asserts:

```ts
expect(savedLine).toMatchObject({
  quantity: 3,
  unit: 'lsn',
  pcsPrice: 12_500,
  lsnPrice: 145_000,
});
expect(voice.speak).toHaveBeenLastCalledWith({
  rowNumber: 1,
  suffix: 'A',
  quantity: 3,
  unit: 'lsn',
  price: 145_000,
});
```

Add invalid-value coverage for a negative or non-integer price.

- [ ] **Step 2: Verify the manual price tests fail**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx tests/unit/mobile-archive-ui.test.tsx`

Expected: FAIL because only one manual price input exists.

- [ ] **Step 3: Implement independent prices**

Replace `ManualDraft.price` with:

```ts
pcsPrice: string;
lsnPrice: string;
```

Validate both as integer rupiah greater than or equal to zero. Store both directly in the line. Use `manual.unit === 'pcs' ? pcsPrice : lsnPrice` for the voice request. Render the two price inputs side by side using the existing two-column manual form rule.

- [ ] **Step 4: Verify manual entry**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx tests/unit/mobile-archive-ui.test.tsx`

Expected: all tests PASS.

### Task 4: One completion action and archive retry

**Files:**
- Modify: `mobile/components/MobileNotaView.tsx:202-220,274`
- Modify: `mobile/components/MobileArchiveView.tsx`
- Modify: `mobile/styles.css:911-929`
- Test: `tests/unit/mobile-nota-ui.test.tsx`
- Test: `tests/unit/mobile-archive-ui.test.tsx`

**Interfaces:**
- Consumes: `OperationsGateway.transferNotaToDesktop`.
- Produces: one completion button, failed transfer messaging, per-note failed badge, and retry button.

- [ ] **Step 1: Write failing completion and retry tests**

Completion test:

```ts
expect(within(dialog).getAllByRole('button')).toHaveLength(2);
fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan ke Arsip dan kirim ke desktop' }));
expect(await screen.findByRole('alert')).toHaveTextContent('Nota tersimpan di Arsip');
expect(screen.getByRole('alert')).toHaveTextContent('CH Core API belum tersedia');
```

Archive test expands a failed note, asserts `Gagal terkirim ke desktop · frontend demo`, the exact reason, and clicks `Sinkronisasi ulang`. The retry must leave status `failed` and show the exact failure reason without changing completion, stock, or revenue.

- [ ] **Step 2: Verify the UI tests fail**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx tests/unit/mobile-archive-ui.test.tsx`

Expected: FAIL because two completion choices remain and archive has no retry.

- [ ] **Step 3: Implement the unified completion flow**

Replace `complete(sendToDesktop)` with `complete()`. Complete to `archive`, then call `transferNotaToDesktop`. Close the dialog after archive completion. For the mock failure, render:

```text
Nota tersimpan di Arsip. Pengiriman ke desktop gagal: CH Core API belum tersedia.
```

The dialog contains only the unified primary action and `Batal`.

- [ ] **Step 4: Implement archive transfer status and retry**

Change the global badge to `Pengiriman desktop · frontend demo`. Inside an expanded failed note, render a transfer panel with the failure badge, reason, and a 44-pixel minimum retry button. Track only the currently retrying transaction ID in component state and call the gateway method again.

- [ ] **Step 5: Verify the focused UI suites**

Run: `npm test -- tests/unit/mobile-nota-ui.test.tsx tests/unit/mobile-archive-ui.test.tsx`

Expected: all tests PASS.

### Task 5: Full verification, commit, and Samsung installation

**Files:**
- Verify all modified source, tests, spec, and plan files.

- [ ] **Step 1: Run full frontend checks**

Run:

```bash
npm run verify
npm run test:e2e
npm run test:mobile
npm run mobile:build
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run Android checks**

With Android Studio JDK 21 and the configured Android SDK, run:

```bash
npm run android:sync
npm run android:test
npm run android:lint
cd android && ./gradlew assembleDebug
```

Expected: all Gradle tasks finish with `BUILD SUCCESSFUL`.

- [ ] **Step 3: Review and commit**

Run `git diff --check`, review the exact diff, stage only planned files, and commit:

```bash
git commit -m "feat: revise mobile nota voice and sync"
```

- [ ] **Step 4: Install and launch on Samsung**

Resolve the authorized ADB serial, then install with:

```bash
adb -s RRCX6066CPA install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s RRCX6066CPA shell am start -n com.tokoch.chucompanion/.MainActivity
```

Verify the package path, running PID, foreground activity, and absence of immediate fatal crashes. Physical speaker confirmation requires scanning a real barcode with media volume enabled.
