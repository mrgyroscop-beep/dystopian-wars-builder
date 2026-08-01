import { describe, expect, it, vi } from "vitest";
import lock from "../source-lock.json" with { type: "json" };
import { verifyLockedProvenance } from "./verify-provenance.mjs";

describe("immutable GitHub provenance", () => {
  it("verifies the locked commit, tree, blobs and sizes", async () => {
    const fetchImpl = mockGitHub();
    await expect(verifyLockedProvenance(lock, { fetchImpl })).resolves.toEqual({
      repository: lock.repository,
      commit: lock.commit,
      tree: lock.tree,
      commitTimestamp: lock.commitTimestamp,
      files: lock.files.map(({ path, blob, bytes }) => ({ path, blob, bytes })),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a substituted commit tree", async () => {
    await expect(
      verifyLockedProvenance(lock, {
        fetchImpl: mockGitHub({ commitTree: "f".repeat(40) }),
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE_COMMIT_MISMATCH" });
  });

  it("rejects a substituted blob or byte size in the resolved tree", async () => {
    await expect(
      verifyLockedProvenance(lock, {
        fetchImpl: mockGitHub({ blob: "f".repeat(40) }),
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE_BLOB_MISMATCH" });
    await expect(
      verifyLockedProvenance(lock, {
        fetchImpl: mockGitHub({ bytes: lock.files[0].bytes + 1 }),
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE_BLOB_MISMATCH" });
  });
});

function mockGitHub(changes = {}) {
  return vi.fn(async (url) => {
    if (url.pathname.includes("/git/commits/")) {
      return Response.json({
        sha: lock.commit,
        tree: { sha: changes.commitTree ?? lock.tree },
        committer: { date: lock.commitTimestamp },
      });
    }
    return Response.json({
      sha: lock.tree,
      truncated: false,
      tree: lock.files.map(({ path, blob, bytes }, index) => ({
        path,
        type: "blob",
        sha: index === 0 ? (changes.blob ?? blob) : blob,
        size: index === 0 ? (changes.bytes ?? bytes) : bytes,
      })),
    });
  });
}
