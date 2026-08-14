export class ActiveSyncPaths {
  private readonly paths = new Set<string>();

  begin(path: string): boolean {
    if (this.paths.has(path)) return false;
    this.paths.add(path);
    return true;
  }

  end(path: string): void {
    this.paths.delete(path);
  }

  get size(): number {
    return this.paths.size;
  }
}

export function hasRemoteFileContent(content: string | undefined): content is string {
  return content !== undefined;
}

export function shouldRecordSuccessfulSync(result: { success: boolean }): boolean {
  return result.success;
}

export function shouldAutoApplyRemote(
  action: "none" | "pull" | "push" | "conflict",
): boolean {
  return action === "pull";
}
