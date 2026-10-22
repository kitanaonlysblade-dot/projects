import { COMPANY } from '@/lib/company';
import { PublicLegal } from '@/components/PublicLegal';

export const metadata = { title: `Privacy Policy - ${COMPANY.name}` };

export default function Page() {
  return <PublicLegal doc="privacy" />;
}
