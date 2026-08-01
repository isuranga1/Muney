import { useState } from 'react'
import type { FormEvent } from 'react'

import {
  BookmarkIcon,
  ExternalLinkIcon,
  ImportIcon,
  MailOpenIcon,
  PlusIcon,
  RefreshIcon,
  RssIcon,
  SearchIcon,
} from '@/components/icons'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
  cx,
} from '@/components/ui'
import { relativeTime, shortDate } from '@/lib/format'
import {
  useArticles,
  useCreateFeed,
  useCreateFeedGroup,
  useDeleteFeed,
  useDeleteFeedGroup,
  useConfig,
  useFeedGroups,
  useImportFeeds,
  useMarkAllRead,
  useRefreshNews,
  useTestFeed,
  useUpdateArticle,
  useUpdateFeed,
} from '@/lib/queries'
import type { Article, Feed } from '@/types'

type GroupDraft = { id?: number; name: string; description: string }
type FeedDraft = {
  id?: number
  group_id: number | null
  name: string
  url: string
  notes: string
  is_enabled: boolean
}

type View = 'all' | 'unread' | 'saved'

export default function News() {
  const groups = useFeedGroups()
  const [view, setView] = useState<View>('all')
  const [activeGroup, setActiveGroup] = useState<number | null>(null)
  const [activeFeed, setActiveFeed] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const articles = useArticles({
    groupId: activeGroup,
    feedId: activeFeed,
    unreadOnly: view === 'unread',
    savedOnly: view === 'saved',
    search,
  })

  const config = useConfig()
  const refresh = useRefreshNews()
  const importFeeds = useImportFeeds()
  const createGroup = useCreateFeedGroup()
  const deleteGroup = useDeleteFeedGroup()
  const createFeed = useCreateFeed()
  const updateFeed = useUpdateFeed()
  const deleteFeed = useDeleteFeed()
  const updateArticle = useUpdateArticle()
  const markAllRead = useMarkAllRead()
  const testFeed = useTestFeed()

  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null)
  const [feedDraft, setFeedDraft] = useState<FeedDraft | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importGroup, setImportGroup] = useState<string>('')
  const [importNewGroup, setImportNewGroup] = useState('')

  const error =
    groups.error ??
    articles.error ??
    refresh.error ??
    importFeeds.error ??
    createGroup.error ??
    createFeed.error ??
    updateFeed.error ??
    deleteFeed.error

  const autoMinutes = config.data?.news_refresh_minutes ?? 0

  const allGroups = groups.data ?? []
  const allFeeds = allGroups.flatMap((g) => g.feeds)
  const totalUnread = allGroups.reduce((sum, g) => sum + g.unread_count, 0)
  const lastFetched = allFeeds
    .map((f) => f.last_fetched_at)
    .filter(Boolean)
    .sort()
    .at(-1)
  // A failed fetch is not the same as a dead feed. Publishers 500 in bursts
  // (EconomyNext does this regularly), and the stored articles are unaffected —
  // so only a feed that has *never* produced anything is worth alarming about.
  const deadFeeds = allFeeds.filter((f) => f.last_status === 'error' && f.article_count === 0)
  const stalledFeeds = allFeeds.filter((f) => f.last_status === 'error' && f.article_count > 0)

  function submitGroup(event: FormEvent) {
    event.preventDefault()
    if (!groupDraft) return
    createGroup.mutate(
      { name: groupDraft.name.trim(), description: groupDraft.description.trim() || null },
      { onSuccess: () => setGroupDraft(null) },
    )
  }

  function submitImport(event: FormEvent) {
    event.preventDefault()
    importFeeds.mutate(
      {
        content: importText,
        group_id: importGroup ? Number(importGroup) : null,
        new_group_name: importNewGroup.trim() || null,
        verify: true,
      },
      {
        onSuccess: () => {
          setImportText('')
          setImportNewGroup('')
        },
      },
    )
  }

  function submitFeed(event: FormEvent) {
    event.preventDefault()
    if (!feedDraft) return
    const body = {
      group_id: feedDraft.group_id,
      name: feedDraft.name.trim(),
      url: feedDraft.url.trim(),
      notes: feedDraft.notes.trim() || null,
      is_enabled: feedDraft.is_enabled,
    }
    const done = { onSuccess: () => setFeedDraft(null) }
    if (feedDraft.id) updateFeed.mutate({ id: feedDraft.id, ...body }, done)
    else createFeed.mutate(body, done)
  }

  if (groups.isLoading) return <Spinner label="Loading feeds…" />

  const hasFeeds = allFeeds.length > 0

  return (
    <div className="animate-rise">
      <SectionHeader
        title="News"
        subtitle={
          hasFeeds
            ? `${allFeeds.length} feed${allFeeds.length === 1 ? '' : 's'} · ${totalUnread} unread · updated ${relativeTime(lastFetched)}${
                autoMinutes > 0 ? ` · auto-refreshes every ${autoMinutes} min` : ''
              }`
            : 'Add any RSS or Atom feed, group them however you like.'
        }
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <ImportIcon size={15} />
              Import
            </Button>
            <Button onClick={() => setManageOpen(true)}>
              <RssIcon size={15} />
              Manage feeds
            </Button>
            <Button
              variant="primary"
              onClick={() => refresh.mutate(undefined)}
              disabled={refresh.isPending || !hasFeeds}
            >
              <RefreshIcon
                size={15}
                className={refresh.isPending ? 'animate-spin-slow' : undefined}
              />
              {refresh.isPending ? 'Fetching…' : 'Refresh now'}
            </Button>
          </>
        }
      />

      <ErrorNote error={error} />

      {refresh.data && (
        <Card className="animate-fade mb-4 px-4 py-3 text-sm">
          Fetched {refresh.data.feeds} feeds · <strong>{refresh.data.new_articles}</strong> new
          article{refresh.data.new_articles === 1 ? '' : 's'}
          {refresh.data.results.some((r) => r.error) && (
            <span className="text-warning">
              {' '}
              · {refresh.data.results.filter((r) => r.error).length} failed
            </span>
          )}
        </Card>
      )}

      {!hasFeeds ? (
        <EmptyState
          title="No feeds yet"
          hint="Add feeds one at a time, or import in bulk — paste an OPML export from Feedly, Inoreader or any other reader, or just a list of feed URLs, one per line."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="primary"
                onClick={() =>
                  setFeedDraft({
                    group_id: null,
                    name: '',
                    url: '',
                    notes: '',
                    is_enabled: true,
                  })
                }
              >
                <PlusIcon size={15} />
                Add a feed
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <ImportIcon size={15} />
                Import OPML or URLs
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {deadFeeds.length > 0 && (
            <Card className="mb-4 border-critical/40 bg-critical/10 px-4 py-3 text-sm">
              <span className="font-medium">
                {deadFeeds.length} feed{deadFeeds.length === 1 ? '' : 's'} never fetched
                successfully:
              </span>{' '}
              {deadFeeds.map((f) => `${f.name} (${f.last_error})`).join(' · ')}
              <span className="block text-xs text-ink-2">
                Check the URL in Manage feeds — a 403 usually means the publisher blocks bots, and
                a 404 means the feed has moved.
              </span>
            </Card>
          )}

          {stalledFeeds.length > 0 && (
            <p className="mb-4 text-xs text-muted">
              Couldn&apos;t refresh {stalledFeeds.map((f) => f.name).join(', ')} just now — showing
              stored articles. Publishers return errors in bursts; it usually clears on the next
              refresh.
            </p>
          )}

          {/* Filters */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(['all', 'unread', 'saved'] as View[]).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={view === value ? 'primary' : 'secondary'}
                onClick={() => setView(value)}
              >
                {value === 'all' ? 'All' : value === 'unread' ? `Unread (${totalUnread})` : 'Saved'}
              </Button>
            ))}

            <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />

            <Select
              className="w-auto py-1.5 text-xs"
              value={activeGroup ?? ''}
              onChange={(e) => {
                setActiveGroup(e.target.value ? Number(e.target.value) : null)
                setActiveFeed(null)
              }}
            >
              <option value="">All groups</option>
              {allGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.unread_count})
                </option>
              ))}
            </Select>

            <Select
              className="w-auto py-1.5 text-xs"
              value={activeFeed ?? ''}
              onChange={(e) => setActiveFeed(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All feeds</option>
              {(activeGroup
                ? (allGroups.find((g) => g.id === activeGroup)?.feeds ?? [])
                : allFeeds
              ).map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.name}
                </option>
              ))}
            </Select>

            <form
              className="relative ml-auto"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(searchInput)
              }}
            >
              <SearchIcon
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <Input
                className="w-52 py-1.5 pl-8 text-xs"
                placeholder="Search headlines…"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value)
                  if (!e.target.value) setSearch('')
                }}
              />
            </form>

            {totalUnread > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => markAllRead.mutate({ group_id: activeGroup, feed_id: activeFeed })}
              >
                <MailOpenIcon size={14} />
                Mark all read
              </Button>
            )}
          </div>

          {articles.isLoading ? (
            <Spinner label="Loading articles…" />
          ) : (articles.data?.length ?? 0) === 0 ? (
            <EmptyState
              title={view === 'saved' ? 'Nothing saved yet' : 'No articles match'}
              hint={
                view === 'saved'
                  ? 'Bookmark an article and it will show up here.'
                  : 'Try clearing the filters, or hit Refresh to pull the latest.'
              }
            />
          ) : (
            <div className="stagger flex flex-col gap-3">
              {articles.data?.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onToggleSaved={() =>
                    updateArticle.mutate({ id: article.id, is_saved: !article.is_saved })
                  }
                  onOpen={() => {
                    if (!article.is_read) {
                      updateArticle.mutate({ id: article.id, is_read: true })
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------------ manage feeds modal */}
      <Modal open={manageOpen} title="Feeds & groups" onClose={() => setManageOpen(false)}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setGroupDraft({ name: '', description: '' })}
            >
              <PlusIcon size={14} />
              New group
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setFeedDraft({
                  group_id: allGroups[0]?.id ?? null,
                  name: '',
                  url: '',
                  notes: '',
                  is_enabled: true,
                })
              }
            >
              <PlusIcon size={14} />
              Add feed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
              <ImportIcon size={14} />
              Import
            </Button>
          </div>

          {allGroups.length === 0 && (
            <p className="text-sm text-muted">
              No groups yet. Feeds can sit ungrouped, but a group makes filtering easier.
            </p>
          )}

          {allGroups.map((group) => (
            <div key={group.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {group.name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {group.feeds.length} feed{group.feeds.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <ConfirmButton
                  onConfirm={() => deleteGroup.mutate(group.id)}
                  message={`Delete "${group.name}", its ${group.feeds.length} feeds and their stored articles?`}
                />
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.feeds.map((feed) => (
                  <FeedRow
                    key={feed.id}
                    feed={feed}
                    onEdit={() =>
                      setFeedDraft({
                        id: feed.id,
                        group_id: feed.group_id,
                        name: feed.name,
                        url: feed.url,
                        notes: feed.notes ?? '',
                        is_enabled: feed.is_enabled,
                      })
                    }
                    onToggle={() =>
                      updateFeed.mutate({ id: feed.id, is_enabled: !feed.is_enabled })
                    }
                    onDelete={() => deleteFeed.mutate(feed.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>

      {/* ------------------------------------------------------ import modal */}
      <Modal
        open={importOpen}
        title="Import feeds"
        onClose={() => {
          setImportOpen(false)
          importFeeds.reset()
        }}
      >
        <form onSubmit={submitImport} className="flex flex-col gap-4">
          <Field
            label="OPML or feed URLs"
            hint="Paste an OPML export from another reader, or one feed URL per line. A line like “Name, https://…” keeps the name."
          >
            <Textarea
              required
              autoFocus
              className="min-h-44 font-mono text-xs"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                'https://economynext.com/feed\nLanka Business Online, https://www.lankabusinessonline.com/feed/\n\n…or paste an entire <opml> document.'
              }
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Add to group">
              <Select
                value={importGroup}
                onChange={(e) => setImportGroup(e.target.value)}
                disabled={Boolean(importNewGroup.trim())}
              >
                <option value="">Ungrouped</option>
                {allGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="…or a new group" hint="Takes precedence over the choice on the left.">
              <Input
                value={importNewGroup}
                onChange={(e) => setImportNewGroup(e.target.value)}
                placeholder="Sri Lanka business"
              />
            </Field>
          </div>

          {importFeeds.data && (
            <div className="glass-inset rounded-xl px-4 py-3 text-sm">
              Imported <strong>{importFeeds.data.imported}</strong>
              {importFeeds.data.skipped > 0 && ` · skipped ${importFeeds.data.skipped} already added`}
              {importFeeds.data.failed.length > 0 && (
                <p className="mt-1 text-xs text-warning">
                  {importFeeds.data.failed.length} could not be fetched:{' '}
                  {importFeeds.data.failed.join(' · ')}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => {
                setImportOpen(false)
                importFeeds.reset()
              }}
            >
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={importFeeds.isPending}>
              {importFeeds.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------- group modal */}
      <Modal open={groupDraft !== null} title="New feed group" onClose={() => setGroupDraft(null)}>
        {groupDraft && (
          <form onSubmit={submitGroup} className="flex flex-col gap-4">
            <Field label="Group name">
              <Input
                required
                autoFocus
                value={groupDraft.name}
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                placeholder="Sri Lanka business"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={groupDraft.description}
                onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setGroupDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create group
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* -------------------------------------------------------- feed modal */}
      <Modal
        open={feedDraft !== null}
        title={feedDraft?.id ? 'Edit feed' : 'Add feed'}
        onClose={() => setFeedDraft(null)}
      >
        {feedDraft && (
          <form onSubmit={submitFeed} className="flex flex-col gap-4">
            <Field label="Feed name">
              <Input
                required
                autoFocus
                value={feedDraft.name}
                onChange={(e) => setFeedDraft({ ...feedDraft, name: e.target.value })}
                placeholder="EconomyNext"
              />
            </Field>

            <Field
              label="Feed URL"
              hint="Any RSS or Atom URL. Tip: news.google.com/rss/search?q=%22your+phrase%22 turns a search into a feed — quote the phrase or it pulls in noise."
            >
              <Input
                required
                type="url"
                value={feedDraft.url}
                onChange={(e) => setFeedDraft({ ...feedDraft, url: e.target.value })}
                placeholder="https://economynext.com/feed"
              />
            </Field>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => testFeed.mutate(feedDraft.url.trim())}
                disabled={!feedDraft.url.trim() || testFeed.isPending}
              >
                {testFeed.isPending ? 'Checking…' : 'Test this URL'}
              </Button>
              {testFeed.data &&
                (testFeed.data.ok ? (
                  <span className="text-xs text-good-text">
                    ✓ {testFeed.data.item_count} items — “{testFeed.data.sample_titles[0]?.slice(0, 44)}…”
                  </span>
                ) : (
                  <span className="text-xs text-critical">✗ {testFeed.data.error}</span>
                ))}
            </div>

            <Field label="Group">
              <Select
                value={feedDraft.group_id ?? ''}
                onChange={(e) =>
                  setFeedDraft({
                    ...feedDraft,
                    group_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Ungrouped</option>
                {allGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Notes">
              <Textarea
                value={feedDraft.notes}
                onChange={(e) => setFeedDraft({ ...feedDraft, notes: e.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setFeedDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {feedDraft.id ? 'Save changes' : 'Add feed'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

function FeedRow({
  feed,
  onEdit,
  onToggle,
  onDelete,
}: {
  feed: Feed
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <li
      className={cx(
        'glass-inset flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm',
        !feed.is_enabled && 'opacity-55',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{feed.name}</span>
          {feed.last_status === 'error' &&
            (feed.article_count === 0 ? (
              <Badge tone="critical">broken</Badge>
            ) : (
              <Badge tone="warning">last refresh failed</Badge>
            ))}
          {!feed.is_enabled && <Badge>paused</Badge>}
        </div>
        <span className="text-xs text-muted">
          {feed.article_count} articles · {relativeTime(feed.last_fetched_at)}
        </span>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {feed.is_enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <ConfirmButton
          onConfirm={onDelete}
          message={`Delete feed "${feed.name}" and its ${feed.article_count} stored articles?`}
        />
      </div>
    </li>
  )
}

function ArticleCard({
  article,
  onToggleSaved,
  onOpen,
}: {
  article: Article
  onToggleSaved: () => void
  onOpen: () => void
}) {
  return (
    <Card className={cx('px-5 py-4', article.is_read && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium text-ink-2">{article.feed_name}</span>
            {article.group_name && <span>· {article.group_name}</span>}
            <span>· {article.published_at ? shortDate(article.published_at.slice(0, 10)) : '—'}</span>
            {!article.is_read && (
              <Badge tone="info" icon="•">
                new
              </Badge>
            )}
          </div>

          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className="group inline-flex items-start gap-1.5 text-base leading-snug font-medium text-ink hover:text-series-1"
          >
            {article.title}
            <ExternalLinkIcon
              size={14}
              className="mt-1 shrink-0 opacity-0 transition group-hover:opacity-70"
            />
          </a>

          {article.summary && (
            <p className="mt-1.5 line-clamp-3 text-sm text-ink-2">{article.summary}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleSaved}
          aria-label={article.is_saved ? 'Remove bookmark' : 'Save article'}
          title={article.is_saved ? 'Remove bookmark' : 'Save article'}
          className={cx(
            'spring grid size-8 shrink-0 place-items-center rounded-full',
            article.is_saved
              ? 'bg-series-1/15 text-series-1'
              : 'text-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10',
          )}
        >
          <BookmarkIcon size={16} filled={article.is_saved} />
        </button>
      </div>
    </Card>
  )
}
