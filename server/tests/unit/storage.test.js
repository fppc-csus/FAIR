import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => {
  const upload = vi.fn();
  const download = vi.fn();
  const remove = vi.fn();
  const from = vi.fn(() => ({ upload, download, remove }));
  return { upload, download, remove, from };
});

vi.mock("../../src/lib/supabase.js", () => ({
  supabase: { storage: { from: storageMocks.from } },
}));

import {
  FORM700_BUCKET,
  archiveWorkbook,
  deleteWorkbook,
  getWorkbook,
  sanitizeFilename,
} from "../../src/lib/storage.js";

describe("private Form 700 workbook storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives an XLSX in the private form700-uploads bucket", async () => {
    storageMocks.upload.mockResolvedValue({ error: null });

    const path = await archiveWorkbook(Buffer.from("xlsx"), "../Form 700.xlsx", {
      filingId: "filing-1",
      politicianId: "politician-1",
    });

    expect(FORM700_BUCKET).toBe("form700-uploads");
    expect(storageMocks.from).toHaveBeenCalledWith("form700-uploads");
    expect(path).toMatch(/^filings\/politician-1\/filing-1\/\d+-Form_700.xlsx$/);
    expect(storageMocks.upload).toHaveBeenCalledWith(
      path,
      expect.any(Buffer),
      expect.objectContaining({ upsert: false }),
    );
  });

  it("retrieves and deletes through the same private bucket", async () => {
    const path = "filings/politician-1/filing-1/workbook.xlsx";
    storageMocks.download.mockResolvedValue({
      data: { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer },
      error: null,
    });
    storageMocks.remove.mockResolvedValue({ error: null });

    await expect(getWorkbook(path)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(deleteWorkbook(path)).resolves.toBeUndefined();
    expect(storageMocks.download).toHaveBeenCalledWith(path);
    expect(storageMocks.remove).toHaveBeenCalledWith([path]);
  });

  it('archives PDF bytes with the PDF content type', async () => {
    storageMocks.upload.mockResolvedValue({ error: null });
    const buffer = Buffer.from('%PDF-1.4');
    const path = await archiveWorkbook(buffer, 'filing.PDF', { filingId: 'f', politicianId: 'p' });
    expect(path).toMatch(/filing.PDF$/);
    expect(storageMocks.upload).toHaveBeenCalledWith(path, buffer, { contentType: 'application/pdf', upsert: false });
  });

  it("sanitizes object-key filenames", () => {
    expect(sanitizeFilename("../../bad name?.xlsx")).toBe("bad_name_.xlsx");
    expect(sanitizeFilename("..\\..\\private\\filing.xlsx")).toBe("filing.xlsx");
    expect(sanitizeFilename(`${'a'.repeat(300)}.xlsx`)).toHaveLength(255);
  });
});
