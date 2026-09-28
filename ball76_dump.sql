--
-- PostgreSQL database dump
--

\restrict wv2M9wytukqnzrNfV3f6w3Zd3AZmo4o3q6CtFgOTuO3eC8cV9MjJ9CfD2U01gzI

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.game_players DROP CONSTRAINT IF EXISTS game_players_player_id_fkey;
ALTER TABLE IF EXISTS ONLY public.game_players DROP CONSTRAINT IF EXISTS game_players_game_id_fkey;
ALTER TABLE IF EXISTS ONLY public.players DROP CONSTRAINT IF EXISTS players_pkey;
ALTER TABLE IF EXISTS ONLY public.players DROP CONSTRAINT IF EXISTS players_name_key;
ALTER TABLE IF EXISTS ONLY public.games DROP CONSTRAINT IF EXISTS games_pkey;
ALTER TABLE IF EXISTS ONLY public.game_players DROP CONSTRAINT IF EXISTS game_players_pkey;
ALTER TABLE IF EXISTS public.players ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.games ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.players_id_seq;
DROP TABLE IF EXISTS public.players;
DROP SEQUENCE IF EXISTS public.games_id_seq;
DROP TABLE IF EXISTS public.games;
DROP TABLE IF EXISTS public.game_players;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: game_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_players (
    game_id integer NOT NULL,
    player_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id integer NOT NULL,
    hall_id text NOT NULL,
    date date NOT NULL
);


--
-- Name: games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.games_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: games_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.games_id_seq OWNED BY public.games.id;


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: players_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;


--
-- Name: games id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games ALTER COLUMN id SET DEFAULT nextval('public.games_id_seq'::regclass);


--
-- Name: players id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);


--
-- Data for Name: game_players; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_players (game_id, player_id, created_at) FROM stdin;
1	4	2026-08-24 14:45:14.166934
1	5	2026-08-24 14:50:09.572428
1	15	2026-08-25 10:00:18.011461
1	16	2026-08-25 10:03:35.014406
2	1	2026-08-25 19:37:59.316886
2	61	2026-08-25 19:38:26.650894
2	62	2026-08-25 19:38:49.872508
2	64	2026-08-25 19:39:39.756962
2	66	2026-08-25 19:40:27.690118
2	67	2026-08-25 19:40:43.095513
2	68	2026-08-25 19:40:56.292408
5	1	2026-08-25 22:35:35.648814
2	81	2026-08-25 22:53:21.894831
2	82	2026-08-25 22:54:13.005145
2	83	2026-08-25 22:57:57.894038
5	83	2026-08-25 22:59:41.75945
5	85	2026-08-25 23:10:43.205587
5	86	2026-08-26 11:41:51.599614
5	87	2026-08-26 11:42:05.279001
5	88	2026-08-26 16:41:12.062682
5	89	2026-08-26 16:41:29.011742
5	90	2026-08-26 16:41:41.297061
5	91	2026-08-26 16:41:59.110036
5	92	2026-08-26 16:42:27.104853
5	93	2026-08-26 16:44:01.36051
3	93	2026-08-31 06:29:44.75862
3	1	2026-08-31 06:30:00.5688
6	1	2026-08-31 06:30:38.365818
6	5	2026-08-31 06:31:04.464541
\.


--
-- Data for Name: games; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.games (id, hall_id, date) FROM stdin;
1	hall1	2026-08-25
2	hall2	2026-08-28
3	hall1	2026-09-01
4	hall2	2026-09-01
5	hall1	2026-08-27
6	hall2	2026-09-04
\.


--
-- Data for Name: players; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.players (id, name) FROM stdin;
1	Волков Сергей Николаевич
3	Буров Игорь Николаевич
4	Симонов Антон Валерьевич
5	Грузин Илья Петрович
6	Иванов Иван Иванович
7	авы аыв ыа
8	ывавыавыа выа ыва
9	Смирнов Илья Олегович
10	Смирнов Илья Генадьевич
11	Петров Антон Сергеевич
14	Иванов Иван ИвановичВ
15	Привет Приветыч Приветов
16	Гуликов Инбак Сарканович
17	Игорев Игорь Павлович
21	Грин Брин Трин
22	Боровин Игорб Ми
23	Первый Первый Второй
24	Второй Первый Седьмой
25	Еще Два Человека
26	Еще один Челик
27	d d s
28	sdfs d d as
29	w w ww
30	Боровин Игорб МиУ
31	Грие Пр Ау
50	Горин Игороь Петам
51	ку ку ку
53	ку ку куу
54	цу цу цу
55	еку еку уке
56	к у у
57	е у к
58	уке уек ук
59	йцу у цйу
61	Волков Ярослав Сергеевич
62	Петров Петр Петрович
63	Сузуков Брум Газович
64	Капитанов Матрос Безногович
65	Записан Пусун Писакович
66	Крупа Стоял Больнович
67	Интерес Мой Неоправданный
68	Игровой Игрок Беспроигрышный
69	Десятый Которого Ждут
80	Волков Сергей Николаевичв
81	Волков Ярослав Николаевич
82	Волков Ярослав Антонович
83	Курин Павел Олегович
86	Петров Сергей Антонович
87	Зарин Игорь Михайлович
85	Сурин Павел Олегович
88	Хмуров Хмур Мур
89	Сиплый Сыч Павлович
90	Херов Игорь Павлович
91	Мудро Петр Игоревич
92	Музло Кондратий Кондратьевич
93	Краш Кирилл Кирилович
\.


--
-- Name: games_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.games_id_seq', 6, true);


--
-- Name: players_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.players_id_seq', 97, true);


--
-- Name: game_players game_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_players
    ADD CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: players players_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_name_key UNIQUE (name);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: game_players game_players_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_players
    ADD CONSTRAINT game_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_players game_players_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_players
    ADD CONSTRAINT game_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict wv2M9wytukqnzrNfV3f6w3Zd3AZmo4o3q6CtFgOTuO3eC8cV9MjJ9CfD2U01gzI

