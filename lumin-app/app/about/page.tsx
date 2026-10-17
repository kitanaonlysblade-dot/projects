import { COMPANY } from '@/lib/company';
import { PublicLegal } from '@/components/PublicLegal';

export const metadata = { title: `About - ${COMPANY.name}` };

export default function Page() {
  return <PublicLegal doc="about" />;
}
