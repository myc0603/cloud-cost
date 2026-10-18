/** 높이 애니메이션 접기 — grid 행을 0fr ↔ 1fr로 전환. 닫혀 있을 땐 inert로 포커스·클릭 차단 */
export default function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
