export const themes = [
    {
        id: 'dark_cyber', // Original
        name: 'Cyber Dark',
        bg: '#161b22',
        headerBg: '#161b22', // '#1f242d',
        text: '#ffffff',
        score: '#ffd700',
        // Sorted from Easiest (Cool) to Hardest (Hot)
        blockColors: ['#40E0D0', '#2cffff', '#f8fd2e', '#ff942c'], 
        // SVG Filter: None (Keep original Gold/Brown)
        svgFilter: 'none' 
    },
    {
        id: 'dark_cyber', // Original
        name: 'Cyber Dark',
        bg: '#161616',
        headerBg: '#161616', //'#1f242d',
        text: '#ffffff',
        score: '#ffd700',
        // Sorted from Easiest (Cool) to Hardest (Hot)
        blockColors: ['#2bffff', '#27fd9d', '#74ff2b', '#f6ff26', '#ff932e', '#fe6e28', '#fc5624'], 
        // SVG Filter: None (Keep original Gold/Brown)
        svgFilter: 'none' 
    },
    {
        id: 'light_cyber', // Original
        name: 'Cyber light',
        bg: '#058aa8',
        headerBg: '#058aa8', //'#22abc9',
        text: '#000000',
        score: '#ffd700',
        // Sorted from Easiest (Cool) to Hardest (Hot)
        blockColors: ['#8de609', '#c9e609', '#e6d709', '#e69509', '#e66909'], 
        // SVG Filter: None (Keep original Gold/Brown)
        svgFilter: 'none' 
    },
    {
        id: 'candy_land',
        name: 'Candy Land',
        bg: '#d2d7da', // Lavender Blush
        headerBg: '#d2d7da', //'#88aed2',
        text: '#000000',
        score: '#f9fd2d',
        // Pastels: Green -> Blue -> Pink -> Red
        blockColors: ['#d5f1d8', '#fdde68', '#a2e0dd', '#fa85b9', '#ff8796', '#ffaca8'],
        // SVG Filter: Rotate hue to make wallet pinkish
        svgFilter: 'hue-rotate(90deg) brightness(1.1)' 
    },
    {
        id: 'dark_solar',
        name: 'Dark Solar',
        bg: '#000', // Lavender Blush
        headerBg: '#000',
        text: '#fff',
        score: '#f2fa02',
        // Pastels: Green -> Blue -> Pink -> Red
        blockColors: ['#f2fa02', '#fae502', '#fac002', '#fa8f02', '#fa6502'],
        // SVG Filter: Rotate hue to make wallet pinkish
        svgFilter: 'none' 
    },
    {
        id: 'dark',
        name: 'Dark',
        bg: '#232531', // Lavender Blush
        headerBg: '#232531', //'#797f9a',
        text: '#fff',
        score: '#fdde68',
        // Pastels: Green -> Blue -> Pink -> Red
        blockColors: ['#b5f46c', '#93dbfa', '#c79fff', '#fdde68', '#ff9a61'],
        // SVG Filter: Rotate hue to make wallet pinkish
        svgFilter: 'none' 
    },
    {
        id: 'deep_ocean',
        name: 'Deep Ocean',
        bg: '#001e2b', // Deep Navy
        headerBg: '#001e2b', //'#004e64',
        text: '#e0fbfc',
        score: '#7afdd6',
        // Blues/Greens: Light Cyan -> Teal -> Blue -> Indigo
        blockColors: ['#98c1d9', '#3d5a80', '#00b4d8', '#4ea8de'],
        // SVG Filter: Cool blue tint
        svgFilter: 'hue-rotate(180deg) contrast(1.2)'
    }
];