-- Washington state universities/colleges for onboarding school search.
-- Adds UW campuses (Seattle / Bothell / Tacoma), WSU branch campuses,
-- and any missing four-year institutions in Washington.

-- Prefer campus-specific UW naming over the generic seed entry.
update public.colleges
set name = 'University of Washington - Seattle',
    region = coalesce(region, 'WA'),
    updated_at = now()
where lower(name) = lower('University of Washington')
  and not exists (
    select 1
    from public.colleges c
    where lower(c.name) = lower('University of Washington - Seattle')
  );

update public.colleges
set name = 'Washington State University - Vancouver',
    region = coalesce(region, 'WA'),
    updated_at = now()
where lower(name) = lower('Washington State University at Vancouver')
  and not exists (
    select 1
    from public.colleges c
    where lower(c.name) = lower('Washington State University - Vancouver')
  );

update public.colleges
set name = 'The Evergreen State College',
    region = coalesce(region, 'WA'),
    updated_at = now()
where lower(name) = lower('Evergreen State College')
  and not exists (
    select 1
    from public.colleges c
    where lower(c.name) = lower('The Evergreen State College')
  );

update public.colleges
set name = 'Saint Martin''s University',
    region = coalesce(region, 'WA'),
    updated_at = now()
where lower(name) = lower('St. Martin''s College')
  and not exists (
    select 1
    from public.colleges c
    where lower(c.name) = lower('Saint Martin''s University')
  );

update public.colleges
set name = 'Whitworth University',
    region = coalesce(region, 'WA'),
    updated_at = now()
where lower(name) = lower('Whitworth College')
  and not exists (
    select 1
    from public.colleges c
    where lower(c.name) = lower('Whitworth University')
  );

insert into public.colleges (name, country, region)
select v.name, v.country, v.region
from (
  values
  -- UW campuses
  ('University of Washington - Seattle', 'US', 'WA'),
  ('University of Washington - Bothell', 'US', 'WA'),
  ('University of Washington - Tacoma', 'US', 'WA'),

  -- Public baccalaureates + branch campuses
  ('Washington State University', 'US', 'WA'),
  ('Washington State University - Tri-Cities', 'US', 'WA'),
  ('Washington State University - Vancouver', 'US', 'WA'),
  ('Washington State University - Spokane', 'US', 'WA'),
  ('Washington State University - Everett', 'US', 'WA'),
  ('Central Washington University', 'US', 'WA'),
  ('Eastern Washington University', 'US', 'WA'),
  ('Western Washington University', 'US', 'WA'),
  ('The Evergreen State College', 'US', 'WA'),

  -- Independent / private four-year
  ('Antioch University - Seattle', 'US', 'WA'),
  ('Bastyr University', 'US', 'WA'),
  ('City University of Seattle', 'US', 'WA'),
  ('DigiPen Institute of Technology', 'US', 'WA'),
  ('Faith International University', 'US', 'WA'),
  ('Gonzaga University', 'US', 'WA'),
  ('Great Northern University', 'US', 'WA'),
  ('Heritage University', 'US', 'WA'),
  ('Northwest University', 'US', 'WA'),
  ('Pacific Lutheran University', 'US', 'WA'),
  ('Pacific Northwest University of Health Sciences', 'US', 'WA'),
  ('Saint Martin''s University', 'US', 'WA'),
  ('Seattle Pacific University', 'US', 'WA'),
  ('Seattle University', 'US', 'WA'),
  ('University of Puget Sound', 'US', 'WA'),
  ('Walla Walla University', 'US', 'WA'),
  ('Western Governors University Washington', 'US', 'WA'),
  ('Whitman College', 'US', 'WA'),
  ('Whitworth University', 'US', 'WA'),

  -- Notable WA colleges often searched alongside universities
  ('Cornish College of the Arts', 'US', 'WA'),
  ('Northwest Indian College', 'US', 'WA')
) as v(name, country, region)
where not exists (
  select 1
  from public.colleges c
  where lower(c.name) = lower(v.name)
);
