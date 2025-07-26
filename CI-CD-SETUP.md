# 🚀 CI/CD Setup Guide for Facebook Messenger Exporter

## Automated Build and Deployment with Vercel

This repository is configured for automatic building and deployment using Vercel with GitHub integration.

## Setup Instructions

### 1. Vercel Account Setup
1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Connect your GitHub account
3. Import this repository

### 2. Environment Variables
Add these secrets to your GitHub repository settings (Settings → Secrets and variables → Actions):

```
VERCEL_TOKEN=your_vercel_token_here
VERCEL_ORG_ID=your_vercel_org_id_here
VERCEL_PROJECT_ID=your_vercel_project_id_here
```

**To get these values:**
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel login`
3. Run `vercel link` in your project directory
4. Check `.vercel/project.json` for org and project IDs
5. Get token from Vercel dashboard → Settings → Tokens

### 3. Automatic Deployment

#### What happens on every push:
1. **Build Process**: Extension files are automatically built
2. **Web Deployment**: Documentation and download page deployed to Vercel
3. **ZIP Generation**: Latest extension ZIP created and made available
4. **Version Bumping**: Automatic version incrementing

#### Deployment URLs:
- **Production**: `https://your-project.vercel.app`
- **Download Page**: `https://your-project.vercel.app/download`
- **User Guide**: `https://your-project.vercel.app/guide`
- **Installation**: `https://your-project.vercel.app/install`

### 4. Build Configuration

#### Files involved:
- `vercel.json` - Vercel deployment configuration
- `.github/workflows/build-deploy.yml` - GitHub Actions workflow
- `vercel-build.sh` - Custom build script for Vercel
- `build.sh` - Main extension build script

#### Build process:
1. Runs extension build script
2. Creates distribution ZIP
3. Copies web files for deployment
4. Deploys to Vercel

### 5. Branch Strategy

#### Main/Master Branch:
- Automatic production deployment
- Version auto-increment
- ZIP file generation

#### Feature Branches:
- Build validation only
- No deployment
- Pull request checks

### 6. Manual Deployment

If you need to deploy manually:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### 7. Download Links

After deployment, users can download the extension from:
- `https://your-project.vercel.app/download`
- Direct ZIP: `https://your-project.vercel.app/dist/facebook-messenger-exporter-v{version}.zip`

### 8. Monitoring

#### Check deployment status:
- GitHub Actions tab for build status
- Vercel dashboard for deployment logs
- Vercel project URL for live site

#### Build logs available at:
- GitHub Actions → Latest workflow run
- Vercel dashboard → Deployments → View logs

## Benefits

✅ **Automatic builds** on every commit  
✅ **Version management** with auto-increment  
✅ **Web deployment** for documentation  
✅ **Download links** always up-to-date  
✅ **No manual deployment** needed  
✅ **Pull request validation** before merge  

## Troubleshooting

### Build fails:
1. Check GitHub Actions logs
2. Verify build script permissions
3. Check if all files are committed

### Deployment fails:
1. Verify Vercel secrets are set correctly
2. Check Vercel project configuration
3. Ensure proper repository permissions

### Download links broken:
1. Check if ZIP files are being generated
2. Verify dist directory structure
3. Check Vercel static file serving

---

**Ready for continuous deployment! Every push automatically builds and deploys your extension! 🚀**
