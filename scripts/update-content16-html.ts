/* eslint-disable */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}
const NEW_HTML = `
<div data-layer="Content Section 16" data-breakpoint="Desktop" class="ContentSection16" style="width: 1512px; padding-left: 30px; padding-right: 30px; padding-top: 120px; padding-bottom: 120px; background: var(--White-white, white); overflow: hidden; flex-direction: column; justify-content: flex-start; align-items: center; display: inline-flex;">
  <div data-layer="Container" class="Container" style="width: 100%; max-width: 1350px; justify-content: flex-start; align-items: flex-start; gap: 30px; display: inline-flex;">
    <div data-layer="Container info" class="ContainerInfo" style="flex: 1 1 0; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 30px; display: inline-flex;">
      <div data-layer="Container info head" class="ContainerInfoHead" style="align-self: stretch; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 13.3px; display: flex;">
        <div data-layer="Tagline" class="Tagline" style="color: var(--Neutral-neutral, #161616); font-size: 18px; font-family: Inter; font-weight: 600; line-height: 27px; word-wrap: break-word;">Tagline</div>
        <div data-layer="Heading" class="Heading" style="align-self: stretch; color: var(--Neutral-neutral, #161616); font-size: 42.63px; font-family: Inter; font-weight: 700; line-height: 51.16px; word-wrap: break-word;">Lorem ipsum dolor</div>
        <div data-layer="Description" class="Description" style="align-self: stretch; color: var(--Neutral-neutral-80, rgba(22, 22, 22, 0.8)); font-size: 24px; font-family: Inter; font-weight: 400; line-height: 36px; word-wrap: break-word;">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</div>
        <div data-layer="Container buttons" class="ContainerButtons" style="justify-content: center; align-items: center; gap: 20px; display: inline-flex; margin-top: 20px;"> <!-- mcms:injected-cta -->
          <div data-layer="Buttons" data-color="Neutral" data-device="Laptop" data-type="Button" class="Buttons" style="padding: 13.3px 30px; background: #161616; border-radius: 4px; display: inline-flex; justify-content: center; align-items: center; gap: 13.3px;">
            <div data-layer="Contact" class="Contact" style="color: white; font-size: 13.5px; font-family: Inter; font-weight: 600; line-height: 20.25px;">Contact now</div>
          </div>
        </div>
      </div>
    </div>
    <div data-layer="Container image" class="ContainerImage" style="flex: 1 1 0; align-self: stretch; flex-direction: column; justify-content: flex-start; align-items: center; gap: 10px; display: inline-flex;">
      <div data-layer="Image 1" class="Image1" style="align-self: stretch; height: 495px; background: #d9d9d9; background-image: url(https://placehold.co/660x495); justify-content: center; align-items: center; gap: 10px; display: inline-flex;">
        <div data-svg-wrapper data-layer="Union" class="Union" style="position: relative">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M9.6 3.2C7.90261 3.2 6.27475 3.87428 5.07452 5.07452C3.87428 6.27475 3.2 7.90261 3.2 9.6V33.6C3.2 35.2974 3.87428 36.9253 5.07452 38.1255C6.11449 39.1655 7.47552 39.8106 8.92464 39.9643L25.4681 21.7658C25.9916 21.1899 26.6296 20.7294 27.341 20.4139C28.0525 20.0984 28.8218 19.9346 29.6001 19.933C30.3783 19.9314 31.1484 20.0921 31.8611 20.4047C32.5737 20.7173 33.2134 21.1751 33.7393 21.7487L40 28.5764V9.6C40 7.90262 39.3257 6.27475 38.1255 5.07452C36.9253 3.87428 35.2974 3.2 33.6 3.2H9.6ZM43.2 33.6192C43.2 33.6128 43.2 33.6064 43.2 33.6V9.6C43.2 7.05392 42.1886 4.61212 40.3882 2.81177C38.5879 1.01143 36.1461 0 33.6 0H9.6C7.05392 0 4.61212 1.01143 2.81177 2.81177C1.01143 4.61212 0 7.05392 0 9.6V33.6C0 36.1461 1.01143 38.5879 2.81177 40.3882C4.61125 42.1877 7.05154 43.199 9.59627 43.2C9.59752 43.2 9.59876 43.2 9.6 43.2L33.866 43.2C36.3415 43.2 38.7157 42.2166 40.4661 40.4661C42.2166 38.7157 43.2 36.3415 43.2 33.866V33.6192ZM40 33.6156V33.6C40 33.4672 39.9875 33.4003 39.9808 33.3726C39.9753 33.3503 39.9695 33.335 39.9555 33.3104C39.937 33.2779 39.8991 33.2206 39.8116 33.1159C39.7267 33.0145 39.6279 32.9063 39.4832 32.7479L39.4384 32.6988L31.3807 23.9113C31.1553 23.6655 30.881 23.4692 30.5756 23.3352C30.2701 23.2012 29.9401 23.1323 29.6066 23.133C29.273 23.1337 28.9433 23.2039 28.6384 23.3391C28.3336 23.4743 28.0601 23.6717 27.8358 23.9184L13.2168 40L33.6 40C35.2974 40 36.9252 39.3257 38.1255 38.1255C39.322 36.9289 39.9959 35.3074 40 33.6156ZM14.6 11.2C12.7222 11.2 11.2 12.7222 11.2 14.6C11.2 16.4778 12.7222 18 14.6 18C16.4778 18 18 16.4778 18 14.6C18 12.7222 16.4778 11.2 14.6 11.2ZM8 14.6C8 10.9549 10.9549 8 14.6 8C18.2451 8 21.2 10.9549 21.2 14.6C21.2 18.2451 18.2451 21.2 14.6 21.2C10.9549 21.2 8 18.2451 8 14.6Z" fill="var(--Neutral-neutral-20, #161616)" fill-opacity="0.2"></path>
          </svg>
        </div>
      </div>
    </div>
  </div>
</div>
`.trim()

async function main(){
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { error } = await sb.from('web_content_templates')
    .update({ source_html: NEW_HTML })
    .eq('id', 'content-section-16')
  if (error) { console.error(error); process.exit(1) }
  console.log('content-section-16 source_html updated')
}
main()
