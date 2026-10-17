import { COMPANY } from '@/lib/company';
import { PublicLegal } from '@/components/PublicLegal';

export const metadata = { title: `Help & contact - ${COMPANY.name}` };

export default function Page() {
  return <PublicLegal doc="help" />;
}
