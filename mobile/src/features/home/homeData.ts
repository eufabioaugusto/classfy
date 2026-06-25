export type HomeContent = {
  id: string;
  title: string;
  creator: string;
  views: string;
  duration: string;
  access: 'free' | 'pro' | 'premium';
  category: string;
  tone: string;
};

export type HomeShort = {
  id: string;
  title: string;
  creator: string;
  tone: string;
};

export const homeCategories = ['Todos', 'Aulas', 'Creators', 'Pro', 'Premium', 'Podcasts', 'Cursos'];

export const featuredContent: HomeContent = {
  id: 'featured-masterclass',
  title: 'Como transformar sua audiencia em receita recorrente',
  creator: 'Classfy Originals',
  views: '18K views',
  duration: '24:18',
  access: 'premium',
  category: 'Masterclass',
  tone: '#261014',
};

export const feedContents: HomeContent[] = [
  {
    id: 'creator-economy',
    title: 'Creator economy: o modelo de monetizacao da nova geracao',
    creator: 'Marina Costa',
    views: '12K views',
    duration: '18:42',
    access: 'free',
    category: 'Aula',
    tone: '#101826',
  },
  {
    id: 'shortform-sales',
    title: 'Venda conteudo sem depender de algoritmo',
    creator: 'Classfy Labs',
    views: '8.4K views',
    duration: '12:05',
    access: 'pro',
    category: 'Pro',
    tone: '#1C1426',
  },
  {
    id: 'study-mode',
    title: 'Do video ao estudo: usando Classy para reter conhecimento',
    creator: 'Ana Prado',
    views: '5.9K views',
    duration: '21:10',
    access: 'free',
    category: 'Estudo',
    tone: '#101F1A',
  },
  {
    id: 'premium-funnel',
    title: 'Funil premium para creators: conteudo, prova e comunidade',
    creator: 'Rafael Lima',
    views: '4.7K views',
    duration: '31:22',
    access: 'premium',
    category: 'Premium',
    tone: '#241C0D',
  },
];

export const shortContents: HomeShort[] = [
  {
    id: 's1',
    title: '3 sinais de que seu conteudo ja pode monetizar',
    creator: 'Classfy',
    tone: '#2A1118',
  },
  {
    id: 's2',
    title: 'O erro que mata comunidades pagas',
    creator: 'Marina Costa',
    tone: '#111F2A',
  },
  {
    id: 's3',
    title: 'Como pensar recompensa sem virar gamificacao barata',
    creator: 'Classfy Labs',
    tone: '#1B1428',
  },
];
