'use client';

import { useState } from 'react';
import {
  Baby, Book, Car, Dumbbell, Flower2, Gamepad2, Gem, Gift, Glasses, Headphones, Home, Laptop, Music,
  Palette, PawPrint, Scissors, Shirt, Smartphone, Sparkles, Tag, Utensils, Watch,
} from 'lucide-react';
import type { Category } from '@/lib/types';

type IconType = typeof Tag;

// First match wins. Matches on the category's name, so categories an admin adds later get a sensible icon
// without a code change; anything unrecognised gets the plain tag.
const RULES: [RegExp, IconType, string][] = [
  [/apparel|fashion|cloth|wear|dress|shirt|outfit/i, Shirt, 'fashion'],
  [/electronic|phone|mobile|gadget|tech/i, Smartphone, 'electronics'],
  [/computer|laptop|pc\b/i, Laptop, 'computers'],
  [/audio|headphone|speaker|sound/i, Headphones, 'audio'],
  [/home|living|furniture|decor|house|kitchen/i, Home, 'home-living'],
  [/accessor|jewel|jewelry|jewellery|bling/i, Gem, 'accessories'],
  [/watch/i, Watch, 'watches'],
  [/glass|eyewear|sunglass/i, Glasses, 'eyewear'],
  [/beauty|makeup|cosmetic|skin|hair|salon/i, Sparkles, 'beauty'],
  [/fitness|sport|gym|workout|outdoor/i, Dumbbell, 'fitness'],
  [/food|snack|drink|grocery|cook/i, Utensils, 'food'],
  [/baby|kid|child|toy/i, Baby, 'baby-kids'],
  [/game|gaming/i, Gamepad2, 'games'],
  [/book|stationery|school|office/i, Book, 'books'],
  [/car|auto|vehicle|motor/i, Car, 'cars'],
  [/pet|dog|cat/i, PawPrint, 'pets'],
  [/garden|plant|flower/i, Flower2, 'garden'],
  [/art|craft|diy|paint/i, Palette, 'art-craft'],
  [/music|instrument/i, Music, 'music'],
  [/gift|party|occasion/i, Gift, 'gifts'],
  [/tool|hardware|sewing|tailor/i, Scissors, 'tools'],
];

export function categoryIconFor(name: string): IconType {
  return RULES.find(([re]) => re.test(name))?.[1] ?? Tag;
}

// The name of this category's photo in public/categories (e.g. "home-living" -> /categories/home-living.jpg).
export function categoryPhotoFor(name: string): string | undefined {
  const slug = RULES.find(([re]) => re.test(name))?.[2];
  return slug ? `/categories/${slug}.jpg` : undefined;
}

// The square next to a category's name: a real photograph. That is the category's own uploaded picture (icon_url) if
// it has one, otherwise the photo file for its kind in public/categories/. If there is no photo (or it can't be
// loaded) it falls back to a drawn icon picked from the name, so a missing file never shows a broken picture.
export function CategoryIcon({ category }: { category: Category }) {
  const Icon = categoryIconFor(category.name);
  const photo = category.iconUrl || categoryPhotoFor(category.name);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = !!photo && failedSrc !== photo;
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(photo)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon size={19} strokeWidth={2} className="text-pink-ink" aria-hidden="true" />
      )}
    </span>
  );
}
