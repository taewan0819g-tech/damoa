export function formatKRW(amount: number): string {
  if (amount >= 10000) {
    const eok = Math.floor(amount / 100000000);
    const man = Math.round((amount % 100000000) / 10000);
    if (eok > 0) {
      return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만원` : `${eok}억원`;
    }
    return `${man.toLocaleString("ko-KR")}만원`;
  }
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function formatPercent(rate: number): string {
  return `연 ${rate.toFixed(2)}%`;
}
