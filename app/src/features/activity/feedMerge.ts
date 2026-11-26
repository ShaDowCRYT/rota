import type { ActivityEvent, ActivityPage } from './activityApi';

export type FeedPageState = {
  nextCursor: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
};

export type FeedPageGate = {
  claim: () => boolean;
  release: () => void;
  isClaimed: () => boolean;
};

export function mergeFeedPages(pages: readonly ActivityPage[]): ActivityEvent[] {
  const seen = new Set<string>();
  const events: ActivityEvent[] = [];

  for (const page of pages) {
    for (const event of page.items) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }

  return events.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function canFetchNextPage(state: FeedPageState): boolean {
  return state.nextCursor !== null && state.hasNextPage && !state.isFetchingNextPage;
}

export function createFeedPageGate(): FeedPageGate {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    release: () => {
      claimed = false;
    },
    isClaimed: () => claimed,
  };
}
