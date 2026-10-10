'use client';

import { useRef, useState } from 'react';
import { Camera, ImagePlus, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import type { Category, CategoryBanner, Product } from '@/lib/types';
import { ApiError, uploadFile } from '@/lib/api';

import { ProductThumbnail } from './Thumbnails';
function emptyProduct(bannerId: string): Product {
  return {
    id: `mp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    price: 0,
    cartCount: 0,
    colors: [],
    sizes: [],
    images: [],
    bannerId,
    // Untracked/unlimited by default — same as every product behaved
    // before stock existed. A merchant opts into tracking by actually
    // setting a number in the Stock field below.
    stockQuantity: undefined,
    inStock: true,
  };
}

interface PhotoEntry {
  id: string;
  // blob: while uploading, the real URL once done — either way, what
  // the <img> below actually renders.
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

// Real files, real uploads — `URL.createObjectURL` gives an instant local
// preview the moment a file's picked, while the actual upload happens in
// the background against POST /uploads. `images` (the value `onChange`
// reports, and so what ends up in the product's image_urls) only ever
// contains real, persistent URLs from entries that finished — never a
// blob: one, which stops resolving the moment this tab closes and would
// leave the saved product pointing at a dead link.
function PhotoUploader({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Seeded once from the incoming images (real URLs already, if editing
  // an existing product) — ProductForm remounts fresh per product being
  // edited, so this only ever needs to run once per editing session, not
  // resync against a prop that changes underneath it.
  const [entries, setEntries] = useState<PhotoEntry[]>(() =>
    images.map((url) => ({ id: url, previewUrl: url, status: 'done' as const })),
  );

  const commit = (next: PhotoEntry[]) => {
    setEntries(next);
    onChange(next.filter((e) => e.status === 'done').map((e) => e.previewUrl));
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const newEntries: PhotoEntry[] = fileList.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }));
    // No need to route this through commit() — every new entry starts as
    // 'uploading', so filtering to 'done' never includes any of them yet;
    // onChange genuinely has nothing new to report until the first one
    // actually finishes.
    setEntries((prev) => [...prev, ...newEntries]);

    newEntries.forEach((entry, i) => {
      uploadFile(fileList[i])
        .then(({ url }) => {
          URL.revokeObjectURL(entry.previewUrl);
          setEntries((prev) => {
            const next = prev.map((e) => (e.id === entry.id ? { ...e, previewUrl: url, status: 'done' as const } : e));
            onChange(next.filter((e) => e.status === 'done').map((e) => e.previewUrl));
            return next;
          });
        })
        .catch((err) => {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entry.id
                ? { ...e, status: 'error' as const, error: err instanceof ApiError ? err.message : 'Upload failed' }
                : e,
            ),
          );
        });
    });
  };

  const handleRemove = (id: string) => {
    const target = entries.find((e) => e.id === id);
    // Only revoke a blob: url still standing in for an in-flight upload
    // — a 'done' entry's previewUrl is the real uploaded URL by then,
    // and revoking a non-blob string is a silent no-op anyway, but this
    // keeps the intent explicit.
    if (target?.status === 'uploading' && target.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(target.previewUrl);
    }
    commit(entries.filter((e) => e.id !== id));
  };

  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-bold text-text">Photos</span>
      <p className="mb-2 text-[11.5px] text-text-mute">
        Snap one with your camera or pick from your gallery — these are what show on the
        product&apos;s detail screen when someone taps into it from the category tile.
      </p>

      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <div key={entry.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob:
                URLs from the file picker (and the real uploaded URLs that
                replace them) aren't compatible with next/image. */}
            <img src={entry.previewUrl} alt="" className="h-full w-full object-cover" />
            {entry.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="text-[10.5px] font-bold text-white">Uploading…</span>
              </div>
            )}
            {entry.status === 'error' && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-hot-pink/70 p-1"
                title={entry.error}
              >
                <span className="text-center text-[9.5px] font-bold leading-tight text-white">
                  Failed — remove and retry
                </span>
              </div>
            )}
            <button
              onClick={() => handleRemove(entry.id)}
              aria-label="Remove photo"
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <button
          onClick={() => cameraInputRef.current?.click()}
          className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-text-mute"
        >
          <Camera size={18} />
          <span className="text-[10.5px]">Camera</span>
        </button>
        {/* `capture="environment"` is what actually opens the device
            camera directly on a phone/tablet instead of just the generic
            file picker — without it, camera access is inconsistent across
            browsers. No `multiple` here: a camera shot is one photo per
            trip, same as taking a real photo would be; tap again to add
            another. Desktop browsers without a camera just ignore
            `capture` and fall back to a normal file picker, so this never
            blocks anyone without one. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />

        <button
          onClick={() => galleryInputRef.current?.click()}
          className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-text-mute"
        >
          <ImagePlus size={18} />
          <span className="text-[10.5px]">Gallery</span>
        </button>
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            handleFiles(e.target.files);
            // Reset so selecting the exact same file again still fires
            // onChange — without this, re-picking an identical file after
            // removing it wouldn't register as a new change.
            e.target.value = '';
          }}
          className="hidden"
        />
      </div>
    </div>
  );
}

function ProductForm({
  product,
  categories,
  categoryBanners,
  onSave,
  onCancel,
}: {
  product: Product;
  categories: Category[];
  categoryBanners: CategoryBanner[];
  onSave: (product: Product) => void;
  onCancel: () => void;
}) {
  const initialBanner = categoryBanners.find((b) => b.id === product.bannerId);
  const [categoryId, setCategoryId] = useState(initialBanner?.categoryId ?? categories[0]?.id ?? '');
  const [draft, setDraft] = useState<Product>(product);

  const bannersForCategory = categoryBanners.filter((b) => b.categoryId === categoryId);

  const handleCategoryChange = (id: string) => {
    setCategoryId(id);
    const firstBanner = categoryBanners.find((b) => b.categoryId === id);
    setDraft((d) => ({ ...d, bannerId: firstBanner?.id ?? '' }));
  };

  const canSave =
    draft.name.trim().length > 0 &&
    draft.price > 0 &&
    (draft.bannerId ?? '').length > 0 &&
    (draft.description ?? '').trim().length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 lg:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[14px] font-bold text-text">{product.name ? 'Edit product' : 'New product'}</p>
          <button onClick={onCancel} aria-label="Close">
            <X size={18} className="text-text-mute" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Photos come first — before the rest of this form, per how
              listing a product is meant to start. */}
          <PhotoUploader images={draft.images ?? []} onChange={(images) => setDraft({ ...draft, images })} />

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Product name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Lightweight scarf"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Price</span>
            <input
              type="number"
              value={draft.price || ''}
              onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
              placeholder="0.00"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Description</span>
            <textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              placeholder="What is it, what's it made of, why would someone want it?"
              className="w-full resize-none rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
          </label>

          {/* Where this shows up in the consumer-facing category catalog —
              required, since that placement is the whole point of this
              tab existing separately from Posts. */}
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Category</span>
            <select
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Collection</span>
            <select
              value={draft.bannerId}
              onChange={(e) => setDraft({ ...draft, bannerId: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            >
              {bannersForCategory.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Colors, comma separated</span>
            <input
              type="text"
              value={draft.colors.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, colors: e.target.value.split(',').map((c) => c.trim()).filter(Boolean) })
              }
              placeholder="#1a1a1a, #c9c2b4"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">Sizes, comma separated</span>
            <input
              type="text"
              value={draft.sizes.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, sizes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="S, M, L"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={Boolean(draft.isNew)}
              onChange={(e) => setDraft({ ...draft, isNew: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-hot-pink"
            />
            <span className="text-[13.5px] text-text">
              Mark as a new arrival
              <span className="block text-[11.5px] text-text-mute">
                Shows up when someone taps &quot;New Arrivals&quot; from the shop sidebar
              </span>
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">
              Stock <span className="font-normal text-text-mute">(optional)</span>
            </span>
            <input
              type="number"
              min={0}
              value={draft.stockQuantity ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  // Empty field means untracked/unlimited (stockQuantity:
                  // undefined) — same as leaving this alone entirely.
                  // Typing "0" is a real, distinct value (out of stock),
                  // not the same as empty, so this checks the raw string
                  // rather than falling back on `Number('') || 0`, which
                  // would make 0 and blank indistinguishable.
                  stockQuantity: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                })
              }
              placeholder="Leave blank for unlimited"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
            <span className="mt-1 block text-[11.5px] text-text-mute">
              Leave blank if you don&apos;t want stock tracked or enforced for this product.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-bold text-text">
              Discount % <span className="font-normal text-text-mute">(optional)</span>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.discountPercent ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  // Same blank-means-unset convention as Stock above —
                  // typing 0 is a real "no discount" value distinct from
                  // never having set one, so this checks the raw string
                  // rather than `Number('') || 0`.
                  discountPercent: e.target.value === '' ? undefined : Math.min(100, Math.max(0, Number(e.target.value))),
                })
              }
              placeholder="Leave blank for no discount"
              className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
            />
            <span className="mt-1 block text-[11.5px] text-text-mute">
              Raising this notifies anyone who&apos;s saved this product to their cart or a video&apos;s watchlist.
            </span>
          </label>
        </div>

        <button
          onClick={() => canSave && onSave(draft)}
          disabled={!canSave}
          className="brand-gradient mt-4 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
        >
          Save product
        </button>
      </div>
    </div>
  );
}

interface MerchantProductsProps {
  products: Product[];
  categories: Category[];
  categoryBanners: CategoryBanner[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
}

// Step one of the required sequence — a product has to exist here before
// it can be attached to a video in the Posts tab. Every product created
// here also actually appears in the real consumer-facing category catalog
// (merged in by page.tsx via bannerId), not just in this dashboard.
export function MerchantProducts({
  products,
  categories,
  categoryBanners,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
}: MerchantProductsProps) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const startNew = () => setEditing(emptyProduct(categoryBanners[0]?.id ?? ''));
  const startEdit = (product: Product) => {
    setEditing(product);
    setOpenMenuId(null);
  };
  const handleSave = (product: Product) => {
    if (products.some((p) => p.id === product.id)) onUpdateProduct(product);
    else onAddProduct(product);
    setEditing(null);
  };

  const bannerTitle = (bannerId?: string) => categoryBanners.find((b) => b.id === bannerId)?.title ?? 'Uncategorized';

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      {openMenuId && <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} aria-hidden="true" />}

      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] font-bold text-text">
          {products.length} product{products.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={startNew}
          className="brand-gradient flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-white"
        >
          <Plus size={15} />
          New product
        </button>
      </div>
      <p className="mb-4 text-[12.5px] text-text-mute">
        Products you list here show up in the category catalog, and are what you&apos;ll pick from
        when you make a video in the Posts tab.
      </p>

      {products.length === 0 ? (
        <p className="py-16 text-center text-[13.5px] text-text-mute">
          No products yet — create one to list it in the category catalog.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {products.map((product) => (
            <div
              key={product.id}
              className="relative flex items-center gap-3 rounded-xl border border-line bg-white p-3"
            >
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-box">
                <ProductThumbnail product={product} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold text-text">{product.name}</p>
                <p className="text-[12.5px] text-text-mute">
                  ${product.price.toFixed(2)} · {bannerTitle(product.bannerId)}
                  {!!product.discountPercent && (
                    <span className="ml-1.5 font-bold text-hot-pink">{product.discountPercent}% off</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setOpenMenuId((id) => (id === product.id ? null : product.id))}
                aria-label="Product options"
                aria-expanded={openMenuId === product.id}
                className="shrink-0 rounded-full p-2 text-text-mute hover:text-text"
              >
                <MoreVertical size={17} />
              </button>
              {openMenuId === product.id && (
                <div className="absolute right-2 top-11 z-20 overflow-hidden rounded-lg bg-white shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
                  <button
                    onClick={() => startEdit(product)}
                    className="block w-full whitespace-nowrap px-3 py-2 text-left text-[12.5px] font-medium text-text"
                  >
                    Edit product
                  </button>
                  <button
                    onClick={() => {
                      onDeleteProduct(product.id);
                      setOpenMenuId(null);
                    }}
                    className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium text-hot-pink"
                  >
                    <Trash2 size={14} />
                    Delete product
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          categoryBanners={categoryBanners}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
