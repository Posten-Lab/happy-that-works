import { Page } from '@/app/components/Page'
import talosMark from '@/assets/talos-mark.png'

export function AboutSettings() {
    return (
        <Page title="About Talos">
            <img src={talosMark} alt="Talos" width={96} height={96} />
            <p className="app__subtitle">Your agents. Your command.</p>
        </Page>
    )
}
