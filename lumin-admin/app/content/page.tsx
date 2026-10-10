'use client';

import { useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  removeProduct,
  removeVideoPost,
  searchContent,
  type ApiProductResult,
  type ApiVideoPostResult,
} from '@/lib/api';

type RemoveTarget =
  | { kind: 'product'; item: ApiProductResult }
  | { kind: 'video_post'; item: ApiVideoPostResult; feed: 'feed' | 'discover' };

export default function ContentPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ApiProductResult[]>([]);
  const [feedPosts, setFeedPosts] = useState<ApiVideoPostResult[]>([]);
  const [discoverPosts, setDiscoverPosts] = useState<ApiVideoPostResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [target, setTarget] = useState<RemoveTarget | null>(null);

  const runSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    searchContent(query)
      .then((res) => {
        setProducts(res.products?.items ?? []);
        setFeedPosts(res.feed?.items ?? []);
        setDiscoverPosts(res.discover?.items ?? []);
        setSearched(true);
      })
      .finally(() => setLoading(false));
  };

  const handleRemove = (reason: string) => {
    if (!target) return;
    const request =
      target.kind === 'product'
        ? removeProduct(target.item.id, reason || undefined)
        : removeVideoPost(target.item.id, reason || undefined);
    request.then(() => {
      if (target.kind === 'product') {
        setProducts((prev) => prev.filter((p) => p.id !== target.item.id));
      } else if (target.feed === 'feed') {
        setFeedPosts((prev) => prev.filter((p) => p.id !== target.item.id));
      } else {
        setDiscoverPosts((prev) => prev.filter((p) => p.id !== target.item.id));
      }
      setTarget(null);
    });
  };

  const noResults = searched && products.length === 0 && feedPosts.length === 0 && discoverPosts.length === 0;

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Content</p>
      <p className="mb-5 text-[13px] text-text-mute">
        Search products and videos across every merchant and account to remove anything that doesn't
        follow platform guidelines.
      </p>

      <form onSubmit={runSearch} className="mb-6 flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products or videos…"
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-hot-pink"
          />
        </div>
        <button type="submit" className="rounded-lg bg-hot-pink px-4 py-2 text-[13px] font-bold text-white">
          Search
        </button>
      </form>

      {loading && <p className="text-[13px] text-text-mute">Searching…</p>}
      {noResults && <p className="text-[13px] text-text-mute">No matches.</p>}

      {products.length > 0 && (
        <section className="mb-6">
          <p className="mb-2 text-[13px] font-bold text-text">Products</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <div key={product.id} className="rounded-xl border border-line bg-white p-3">
                <div className="mb-2 aspect-square overflow-hidden rounded-lg bg-panel">
                  {product.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.images[0].url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mb-1 truncate text-[12px] font-bold text-text">{product.name}</p>
                <p className="mb-2 text-[12px] text-text-mute">${product.price}</p>
                <button
                  onClick={() => setTarget({ kind: 'product', item: product })}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-line py-1.5 text-[11px] font-medium text-danger hover:bg-danger/5"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {feedPosts.length > 0 && (
        <VideoSection
          title="Shop feed videos"
          posts={feedPosts}
          onRemove={(item) => setTarget({ kind: 'video_post', item, feed: 'feed' })}
        />
      )}

      {discoverPosts.length > 0 && (
        <VideoSection
          title="Discover videos"
          posts={discoverPosts}
          onRemove={(item) => setTarget({ kind: 'video_post', item, feed: 'discover' })}
        />
      )}

      {target && (
        <ConfirmDialog
          title={`Remove this ${target.kind === 'product' ? 'listing' : 'video'}?`}
          body="This deletes it permanently and notifies the owner."
          noteLabel="Reason (shown to the owner)"
          notePlaceholder="e.g. Counterfeit item"
          confirmLabel="Remove"
          danger
          onConfirm={handleRemove}
          onClose={() => setTarget(null)}
        />
      )}
    </AdminShell>
  );
}

function VideoSection({
  title,
  posts,
  onRemove,
}: {
  title: string;
  posts: ApiVideoPostResult[];
  onRemove: (post: ApiVideoPostResult) => void;
}) {
  return (
    <section className="mb-6">
      <p className="mb-2 text-[13px] font-bold text-text">{title}</p>
      <div className="space-y-2">
        {posts.map((post) => (
          <div
            key={post.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold text-text">{post.poster_display_name}</p>
              <p className="truncate text-[12px] text-text-mute">{post.description}</p>
            </div>
            <button
              onClick={() => onRemove(post)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger/5"
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
