'use client';

import { useEffect, useState } from 'react';
import { BarChart3, ClipboardList, HelpCircle, LayoutGrid, LogOut, Tag, Video, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category, CategoryBanner, MerchantAccount, Order, Product, VideoPost } from '@/lib/types';
import { MerchantOrders } from './MerchantOrders';
import { MerchantPosts } from './MerchantPosts';
import { MerchantProducts } from './MerchantProducts';
import { MerchantAnalytics } from './MerchantAnalytics';
import { MerchantPayouts } from './MerchantPayouts';
import { MerchantInsights } from './MerchantInsights';
import { TWIN_ENABLED } from '@/lib/features';

export type MerchantSection = 'overview' | 'products' | 'posts' | 'orders' | 'payouts' | 'analytics' | 'demand';

const allSections: { id: MerchantSection; label: string; Icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', Icon: LayoutGrid },
  { id: 'products', label: 'Products', Icon: Tag },
  { id: 'posts', label: 'Posts', Icon: Video },
  { id: 'demand', label: 'Demand', Icon: HelpCircle },
  { id: 'orders', label: 'Orders', Icon: ClipboardList },
  { id: 'payouts', label: 'Payouts', Icon: Wallet },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
];
// Demand (requests you can answer, keyword insights) is part of the twin discovery layer.
const sections = allSections.filter((s) => TWIN_ENABLED || s.id !== 'demand');

function OverviewSection({
  account,
  productsCount,
  postsCount,
  ordersCount,
  revenue,
  onGoToPayouts,
}: {
  account: MerchantAccount;
  productsCount: number;
  postsCount: number;
  ordersCount: number;
  revenue: number;
  onGoToPayouts: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col px-4 py-5 lg:px-8 lg:py-8">
      <p className="text-[12.5px] font-bold uppercase tracking-wide text-hot-pink">{account.category}</p>
      <h2 className="mt-0.5 text-lg font-bold text-text lg:text-xl">{account.businessName}</h2>
      {account.description && (
        <p className="mt-1.5 max-w-md text-[13.5px] leading-snug text-text-mute">{account.description}</p>
      )}

      {!account.payoutReady && (
        <button
          onClick={onGoToPayouts}
          className="mt-4 max-w-md rounded-xl border border-hot-pink/30 bg-hot-pink/5 p-3 text-left"
        >
          <p className="text-[13.5px] font-bold text-hot-pink">Set up payouts</p>
          <p className="mt-0.5 text-[12.5px] text-text-mute">
            Orders are still selling without this, but funds have nowhere to release to until you add
            a bank account.
          </p>
        </button>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2.5 lg:max-w-lg lg:grid-cols-4">
        {[
          { label: 'Products', value: String(productsCount) },
          { label: 'Posts', value: String(postsCount) },
          { label: 'Orders', value: String(ordersCount) },
          { label: 'Revenue', value: `$${revenue.toFixed(2)}` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-line bg-white p-3.5 text-center">
            <p className="text-[16px] font-bold text-text">{stat.value}</p>
            <p className="text-[11.5px] text-text-mute">{stat.label}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-md text-[12.5px] text-text-mute">
        Every number here — including the charts in Analytics — comes from what you&apos;ve actually
        listed, posted, and sold. Nothing is sample data.
      </p>
    </div>
  );
}

interface MerchantDashboardProps {
  account: MerchantAccount;
  onSwitchToPersonal: () => void;
  posts: VideoPost[];
  onAddPost: (post: VideoPost) => void;
  onUpdatePost: (post: VideoPost) => void;
  onDeletePost: (post: VideoPost) => void;
  onOpenPost: (post: VideoPost) => void;
  orders: Order[];
  onAdvanceOrderStatus: (id: string, status: Order['status']) => void;
  onCancelOrder: (id: string, reason?: string) => void;
  merchantProducts: Product[];
  categories: Category[];
  categoryBanners: CategoryBanner[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
  onAddPayout: (bankCode: string, accountNumber: string) => Promise<void>;
  // Lets the parent remember which section was open across a trip to the
  // post gallery player and back (this component remounts on return).
  initialSection?: MerchantSection;
  onSectionChange?: (section: MerchantSection) => void;
}

// Admin-dashboard shape (sidebar nav, plain content panels) rather than the
// immersive full-bleed video UI the rest of the app uses — a seller
// dashboard is a "get information, take action" surface, not a "watch
// content" one, so it deliberately doesn't try to look like the shop/
// discover player.
export function MerchantDashboard({
  account,
  onSwitchToPersonal,
  posts,
  onAddPost,
  onUpdatePost,
  onDeletePost,
  onOpenPost,
  orders,
  onAdvanceOrderStatus,
  onCancelOrder,
  merchantProducts,
  categories,
  categoryBanners,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onAddPayout,
  initialSection,
  onSectionChange,
}: MerchantDashboardProps) {
  const [active, setActive] = useState<MerchantSection>(
    initialSection && (TWIN_ENABLED || initialSection !== 'demand') ? initialSection : 'overview',
  );
  useEffect(() => {
    onSectionChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const revenue = orders.reduce((sum, o) => sum + o.price, 0);

  return (
    <div className="flex h-full flex-col bg-panel lg:flex-row">
      {/* Desktop: real sidebar. */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="border-b border-line px-5 py-5">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-hot-pink">Business page</p>
          <p className="mt-0.5 truncate text-[14px] font-bold text-text">{account.businessName}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              aria-current={active === id ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium ${
                active === id ? 'bg-hot-pink/10 text-hot-pink' : 'text-text-mute hover:bg-panel hover:text-text'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={onSwitchToPersonal}
          className="flex items-center gap-2.5 border-t border-line px-5 py-4 text-left text-[13.5px] font-medium text-text-mute hover:text-text"
        >
          <LogOut size={17} />
          Switch to personal
        </button>
      </aside>

      {/* Mobile/tablet: top bar + horizontally scrollable tab strip instead
          of a sidebar — there's no room for one, and this app doesn't use
          a bottom-nav pattern anywhere else to borrow from. */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-4 lg:hidden">
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-hot-pink">Business page</p>
          <p className="truncate text-[13px] font-bold text-text">{account.businessName}</p>
        </div>
        <button
          onClick={onSwitchToPersonal}
          aria-label="Switch to personal account"
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-text-mute"
        >
          Switch
        </button>
      </div>
      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-white px-4 py-2.5 lg:hidden">
        {sections.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            aria-current={active === id ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
              active === id ? 'brand-gradient text-white' : 'bg-panel text-text-mute'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {active === 'overview' && (
          <OverviewSection
            account={account}
            productsCount={merchantProducts.length}
            postsCount={posts.length}
            ordersCount={orders.length}
            revenue={revenue}
            onGoToPayouts={() => setActive('payouts')}
          />
        )}
        {active === 'products' && (
          <MerchantProducts
            products={merchantProducts}
            categories={categories}
            categoryBanners={categoryBanners}
            onAddProduct={onAddProduct}
            onUpdateProduct={onUpdateProduct}
            onDeleteProduct={onDeleteProduct}
          />
        )}
        {active === 'posts' && (
          <MerchantPosts
            posts={posts}
            merchantProducts={merchantProducts}
            onAddPost={onAddPost}
            onUpdatePost={onUpdatePost}
            onDeletePost={onDeletePost}
            onOpenPost={onOpenPost}
            onGoToProducts={() => setActive('products')}
          />
        )}
        {active === 'demand' && <MerchantInsights />}
        {active === 'orders' && (
          <MerchantOrders orders={orders} onAdvanceStatus={onAdvanceOrderStatus} onCancel={onCancelOrder} />
        )}
        {active === 'analytics' && <MerchantAnalytics orders={orders} posts={posts} />}
        {active === 'payouts' && <MerchantPayouts account={account} onSave={onAddPayout} />}
      </div>
    </div>
  );
}
