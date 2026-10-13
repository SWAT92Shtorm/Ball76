--
-- PostgreSQL database dump (АНОНИМИЗИРОВАННЫЙ ПРИМЕР)
--
-- Реальные ФИО игроков и служебные ключи удалены.
-- Используется только как пример структуры схемы.
--

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
1	Игрок 1
3	Игрок 2
4	Игрок 3
5	Игрок 4
6	Игрок 5
7	Игрок 6
8	Игрок 7
9	Игрок 8
10	Игрок 9
11	Игрок 10
14	Игрок 11
15	Игрок 12
16	Игрок 13
17	Игрок 14
21	Игрок 15
22	Игрок 16
23	Игрок 17
24	Игрок 18
25	Игрок 19
26	Игрок 20
27	Игрок 21
28	Игрок 22
29	Игрок 23
30	Игрок 24
31	Игрок 25
50	Игрок 26
51	Игрок 27
53	Игрок 28
54	Игрок 29
55	Игрок 30
56	Игрок 31
57	Игрок 32
58	Игрок 33
59	Игрок 34
61	Игрок 35
62	Игрок 36
63	Игрок 37
64	Игрок 38
65	Игрок 39
66	Игрок 40
67	Игрок 41
68	Игрок 42
69	Игрок 43
80	Игрок 44
81	Игрок 45
82	Игрок 46
83	Игрок 47
86	Игрок 48
87	Игрок 49
85	Игрок 50
88	Игрок 51
89	Игрок 52
90	Игрок 53
91	Игрок 54
92	Игрок 55
93	Игрок 56
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
