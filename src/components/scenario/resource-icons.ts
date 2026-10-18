import {
  Archive,
  ArrowUpFromLine,
  Boxes,
  Container,
  Database,
  Globe,
  HardDrive,
  type LucideIcon,
  Network,
  Router,
  ScrollText,
  Server,
  Zap,
} from 'lucide-react';
import type { ResourceType } from '@/lib/estimator';

/** 리소스 타입별 아이콘 — 추가 메뉴와 리소스 카드 제목이 같은 아이콘을 쓴다 */
export const RESOURCE_ICON: Record<ResourceType, LucideIcon> = {
  vm: Server,
  k8s: Boxes,
  container: Container,
  db: Database,
  cache: Zap,
  lb: Network,
  nat: Router,
  egress: ArrowUpFromLine,
  cdn: Globe,
  block: HardDrive,
  object: Archive,
  logs: ScrollText,
};
