export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_KEY = 'theme';

/**
 * <head>에서 첫 페인트 전에 실행 — 저장된 선택(없으면 시스템 설정)대로 html.dark를 붙여 흰 화면 번쩍임을 막는다.
 * localStorage 접근이 막힌 환경(사생활 보호 모드 등)이면 시스템 설정만 따른다.
 */
export const THEME_INIT_SCRIPT = `(function(){var m;try{m=localStorage.getItem('${THEME_KEY}')}catch(e){}var d=m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)})()`;
