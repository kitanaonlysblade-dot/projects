'use client';

import { useEffect, useState } from 'react';
import { Heart, Search } from 'lucide-react';
import type { Product, SearchPerson, VideoPost } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { search as apiSearch, type SearchFilterKey } from '@/lib/api';
import { apiPersonResultToSearchPerson, apiProductToProduct, apiVideoPostToVideoPost } from '@/lib/adapters';
import { PageHeader } from './PageHeader';
import { ProductTile } from './ProductTile';

import { PostThumbnail } from './Thumbnails';
interface SearchScreenProps {
  onBack: () => void;
  onSelectProduct: (product: Product) => void;
  onSelectShopPost: (post: VideoPost) => void;
  onSelectDiscoverPost: (post: VideoPost) => void;
  onSelectPerson: (person: SearchPerson) => void;
}

type FilterKey = SearchFilterKey;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'product', label: 'Product' },
  { key: 'feed', label: 'Feed' },
  { key: 'discover', label: 'Discover' },
];

// One of GET /search's four sections, already adapted to frontend types
// — `total` is the real match count across the whole catalog/feeds, not
// just how many happen to be in `items` (one page of it), which is the
// actual point of this no longer being a client-side .filter() over
// whatever was already loaded for other screens.
interface ResultSection<T> {
  items: T[];
  total: number;
}

interface Results {
  people: ResultSection<SearchPerson> | null;
  products: ResultSection<Product> | null;
  feed: ResultSection<VideoPost> | null;
  discover: ResultSection<VideoPost> | null;
}

function VideoTile({ post, onClick }: { post: VideoPost; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative aspect-[9/13] overflow-hidden rounded-xl bg-[#2a2a28] text-left"
    >
      <PostThumbnail post={post} />
      <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
      <span className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 text-[11.5px] font-medium text-white">
        <span className="truncate">{post.posterName}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Heart size={13} />
          {formatCount(post.likes)}
        </span>
      </span>
    </button>
  );
}

// Site-wide, unlike CategoryCatalog's search — this is what the search
// icon in both the shop feed and discover opens, so it needs to cover
// everything a person might be looking for: creators, products across
// every category, and video posts from both feeds. The filter row below
// the search bar is always there (not just once a query exists) — it's
// what someone reaches for before they've even typed anything, to decide
// what kind of thing they're about to search for.
//
// Backed by GET /search now (debounced 300ms), not a client-side
// .filter() over props — there's nothing to load ahead of time here
// anymore, which is why this component takes no product/post arrays at
// all, just the five callbacks for what happens when a result is tapped.
export function SearchScreen({
  onBack,
  onSelectProduct,
  onSelectShopPost,
  onSelectDiscoverPost,
  onSelectPerson,
}: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(() => {
      apiSearch({ q, filter: activeFilter, limit: 20 })
        .then((res) => {
          if (cancelled) return;
          setResults({
            people: res.people
              ? { items: res.people.items.map(apiPersonResultToSearchPerson), total: res.people.total }
              : null,
            products: res.products
              ? { items: res.products.items.map(apiProductToProduct), total: res.products.total }
              : null,
            feed: res.feed
              ? { items: res.feed.items.map(apiVideoPostToVideoPost), total: res.feed.total }
              : null,
            discover: res.discover
              ? { items: res.discover.items.map(apiVideoPostToVideoPost), total: res.discover.total }
              : null,
          });
        })
        .catch(() => {
          if (!cancelled) setResults(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [q, activeFilter]);


  const showPeople = activeFilter === 'all' || activeFilter === 'people';
  const showProducts = activeFilter === 'all' || activeFilter === 'product';
  const showFeed = activeFilter === 'all' || activeFilter === 'feed';
  const showDiscover = activeFilter === 'all' || activeFilter === 'discover';

  const peopleSection = showPeople ? results?.people : null;
  const productsSection = showProducts ? results?.products : null;
  const feedSection = showFeed ? results?.feed : null;
  const discoverSection = showDiscover ? results?.discover : null;

  const hasResults =
    (peopleSection?.items.length ?? 0) > 0 ||
    (productsSection?.items.length ?? 0) > 0 ||
    (feedSection?.items.length ?? 0) > 0 ||
    (discoverSection?.items.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader
        title="Search"
        onBack={onBack}
        backLabel="Back"
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search people, products, and videos"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-4 py-4 lg:max-w-none lg:px-10 lg:py-6">
          {/* An explicit "All" chip alongside the category ones — tapping
              the active chip again doesn't clear it back to "all"; the
              only way back to no filter is picking "All" itself. */}
          <div className="mb-5 flex gap-2 overflow-x-auto">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                aria-pressed={activeFilter === key}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold transition-colors ${
                  activeFilter === key
                    ? 'border-hot-pink bg-hot-pink text-white'
                    : 'border-line bg-white text-text-mute'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!q ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Search size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">Search Lumin</p>
              <p className="max-w-[240px] text-[13.5px] text-text-mute">
                Find creators, products from any category, or videos from the shop feed and Discover.
              </p>
            </div>
          ) : loading && !results ? (
            <p className="py-16 text-center text-sm text-text-mute">Searching…</p>
          ) : !hasResults ? (
            <p className="py-16 text-center text-sm text-text-mute">
              No results for &quot;{query}&quot;.
            </p>
          ) : (
            <>
              {peopleSection && peopleSection.items.length > 0 && (
                <section className="mb-6">
                  <h2 className="mb-2.5 text-[13px] font-bold text-text">
                    People <span className="text-text-mute">({peopleSection.total})</span>
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {peopleSection.items.map((person) => (
                      <button
                        key={person.id}
                        onClick={() => onSelectPerson(person)}
                        className="flex items-center gap-3 rounded-xl border border-line bg-white p-2.5 text-left"
                      >
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-box">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={person.avatarUrl || '/images/placeholder.svg'}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                        <span className="truncate text-[13px] font-bold text-text">{person.displayName}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {productsSection && productsSection.items.length > 0 && (
                <section className="mb-6">
                  <h2 className="mb-2.5 text-[13px] font-bold text-text">
                    Products <span className="text-text-mute">({productsSection.total})</span>
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {productsSection.items.map((product) => (
                      <ProductTile key={product.id} product={product} onSelectProduct={onSelectProduct} />
                    ))}
                  </div>
                </section>
              )}

              {feedSection && feedSection.items.length > 0 && (
                <section className="mb-6">
                  <h2 className="mb-2.5 text-[13px] font-bold text-text">
                    Feed <span className="text-text-mute">({feedSection.total})</span>
                  </h2>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                    {feedSection.items.map((post) => (
                      <VideoTile key={post.id} post={post} onClick={() => onSelectShopPost(post)} />
                    ))}
                  </div>
                </section>
              )}

              {discoverSection && discoverSection.items.length > 0 && (
                <section>
                  <h2 className="mb-2.5 text-[13px] font-bold text-text">
                    Discover <span className="text-text-mute">({discoverSection.total})</span>
                  </h2>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                    {discoverSection.items.map((post) => (
                      <VideoTile key={post.id} post={post} onClick={() => onSelectDiscoverPost(post)} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
